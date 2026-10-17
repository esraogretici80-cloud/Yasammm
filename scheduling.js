const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
let statusWorker;

function ensureGuildCollection(db, name, guildId) {
  db[name] ||= {};
  db[name][guildId] ||= {};
  return db[name][guildId];
}

function tasksFor(db, guildId) {
  return ensureGuildCollection(db, "tasks", guildId);
}

function tournamentsFor(db, guildId) {
  return ensureGuildCollection(db, "tournaments", guildId);
}

function parseDateTime(value) {
  if (!ISO_WITH_TIMEZONE.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validateTimeWindow(startAt, endAt, now = Date.now()) {
  if (!startAt || !endAt) {
    return "Tarihleri `2026-10-20T19:00+03:00` biçiminde ve saat dilimi farkıyla gir.";
  }
  if (startAt <= now) return "Başlangıç zamanı gelecekte olmalı.";
  if (endAt <= startAt) return "Bitiş zamanı başlangıçtan sonra olmalı.";
  if (endAt > now + WEEK_MS) return "Etkinliğin bitişi şu andan en fazla 7 gün sonra olabilir.";
  return null;
}

function overlaps(startAt, endAt, otherStartAt, otherEndAt) {
  return startAt < otherEndAt && endAt > otherStartAt;
}

function normalizeFacility(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("tr");
}

function isTaskActive(task) {
  return task.status === "scheduled" || task.status === "live";
}

function isTournamentActive(tournament) {
  return tournament.status === "open" || tournament.status === "live";
}

function findFacilityConflict(db, guildId, facilityKey, startAt, endAt) {
  return Object.values(tasksFor(db, guildId)).find(task =>
    isTaskActive(task) &&
    task.facilityKey === facilityKey &&
    overlaps(startAt, endAt, task.startAt, task.endAt)
  );
}

function findMemberConflict(db, guildId, userId, startAt, endAt, ignoredType, ignoredId) {
  const tasks = tasksFor(db, guildId);
  for (const [id, task] of Object.entries(tasks)) {
    if (ignoredType === "task" && id === ignoredId) continue;
    if (
      isTaskActive(task) &&
      [...task.participants, ...task.waitlist].includes(userId) &&
      overlaps(startAt, endAt, task.startAt, task.endAt)
    ) {
      return { title: task.title, kind: "görev" };
    }
  }

  const tournaments = tournamentsFor(db, guildId);
  for (const [id, tournament] of Object.entries(tournaments)) {
    if (ignoredType === "tournament" && id === ignoredId) continue;
    if (
      isTournamentActive(tournament) &&
      tournament.participants.includes(userId) &&
      overlaps(startAt, endAt, tournament.startAt, tournament.endAt)
    ) {
      return { title: tournament.title, kind: "turnuva" };
    }
  }
  return null;
}

function taskEmbed(task) {
  const status = task.status === "scheduled" ? "🟡 Kayıt açık" :
    task.status === "live" ? "🟢 Devam ediyor" :
    task.status === "completed" ? "✅ Tamamlandı" : "⛔ İptal edildi";
  return new EmbedBuilder()
    .setColor(task.status === "live" ? 0x35d07f : task.status === "cancelled" ? 0xef4444 : 0x8b5cf6)
    .setTitle(`📋 ${task.title}`)
    .setDescription(task.description || "Göreve katılmak için gerekli rolü taşımalı ve aşağıdaki düğmeyi kullanmalısın.")
    .addFields(
      { name: "📍 Tesis", value: task.facility, inline: true },
      { name: "🎭 Gerekli rol", value: `<@&${task.roleId}>`, inline: true },
      { name: "📌 Durum", value: status, inline: true },
      { name: "🕒 Başlangıç", value: `<t:${Math.floor(task.startAt / 1000)}:F> · <t:${Math.floor(task.startAt / 1000)}:R>`, inline: true },
      { name: "🏁 Bitiş", value: `<t:${Math.floor(task.endAt / 1000)}:F> · <t:${Math.floor(task.endAt / 1000)}:R>`, inline: true },
      { name: "👥 Kadro", value: `${task.participants.length}/${task.capacity} · Yedek: ${task.waitlist.length}`, inline: true }
    )
    .setTimestamp();
}

function taskComponents(task) {
  const closed = task.status !== "scheduled" || Date.now() >= task.startAt;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gorev:join:${task.id}`)
      .setLabel("Göreve katıl")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`gorev:leave:${task.id}`)
      .setLabel("Ayrıl")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed)
  )];
}

function tournamentEmbed(tournament) {
  const status = tournament.status === "open" ? "🟡 Kayıt açık" :
    tournament.status === "live" ? `🟢 ${tournament.round}. tur` :
    tournament.status === "completed" ? "🏆 Tamamlandı" : "⛔ İptal edildi";
  const matches = tournament.matches || [];
  const bracket = matches.length
    ? matches.map(match => {
      const result = match.winnerId ? ` → Kazanan: <@${match.winnerId}>` : "";
      return `• <@${match.player1}> × <@${match.player2}>${result}`;
    }).join("\n")
    : tournament.championId
      ? `Şampiyon: <@${tournament.championId}>`
      : "Eşleşmeler kayıtlar kapanınca oluşturulur.";
  const byeLine = (tournament.autoAdvancePlayers || []).length
    ? `\n\nBu turu maç yapmadan geçen: ${(tournament.autoAdvancePlayers || []).map(id => `<@${id}>`).join(", ")}`
    : "";

  return new EmbedBuilder()
    .setColor(tournament.status === "live" ? 0xf59e0b : tournament.status === "completed" ? 0x35d07f : 0x8b5cf6)
    .setTitle(`🏆 ${tournament.title}`)
    .setDescription(`${status}\nBaşlangıç: <t:${Math.floor(tournament.startAt / 1000)}:F> · <t:${Math.floor(tournament.startAt / 1000)}:R>\nSüre: ${tournament.durationMinutes} dakika\nKadro: ${tournament.participants.length}/${tournament.capacity}${tournament.roleId ? `\nGerekli rol: <@&${tournament.roleId}>` : ""}\n\n${bracket}${byeLine}`)
    .setTimestamp();
}

function tournamentComponents(tournament) {
  const closed = tournament.status !== "open" || Date.now() >= tournament.startAt;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`turnuva:join:${tournament.id}`)
      .setLabel("Turnuvaya katıl")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`turnuva:leave:${tournament.id}`)
      .setLabel("Ayrıl")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed)
  )];
}

async function updatePanel(client, guildId, channelId, messageId, embed, components) {
  if (!channelId || !messageId) return;
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [embed], components });
  } catch (error) {
    console.warn("Zamanlı etkinlik paneli güncellenemedi:", error.message);
  }
}

async function announce(client, guildId, channelId, embed) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  } catch (error) {
    console.warn("Zamanlı etkinlik duyurusu gönderilemedi:", error.message);
  }
}

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildTournamentRound(tournament, advancingPlayers) {
  const players = shuffle(advancingPlayers);
  tournament.autoAdvancePlayers = players.length % 2 ? [players.pop()] : [];
  tournament.matches = [];
  for (let i = 0; i < players.length; i += 2) {
    tournament.matches.push({
      id: `${tournament.round}-${i / 2 + 1}`,
      player1: players[i],
      player2: players[i + 1],
      winnerId: null
    });
  }
}

function roundAnnouncement(tournament) {
  const lines = (tournament.matches || []).map(match =>
    `• ${match.id}: <@${match.player1}> × <@${match.player2}>`
  );
  for (const playerId of tournament.autoAdvancePlayers || []) {
    lines.push(`• <@${playerId}> bu turu maç yapmadan geçiyor.`);
  }
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`🏆 ${tournament.title} — ${tournament.round}. tur`)
    .setDescription(lines.join("\n") || "Bu tur için eşleşme yok.")
    .setFooter({ text: "Sonuçları yetkililer /turnuva-sonuc komutuyla bildirebilir." });
}

function hasEventPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function taskList(interaction, db) {
  const active = Object.values(tasksFor(db, interaction.guildId))
    .filter(task => isTaskActive(task))
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, 10);
  if (!active.length) {
    return interaction.reply({ content: "Şu anda planlanmış veya devam eden görev yok.", ephemeral: true });
  }
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle("📋 Çiftlik ve fabrika görevleri")
    .setDescription("Kayıtlar görev başlamadan kapanır. Aynı tesiste ve aynı oyuncu için saat çakışmasına izin verilmez.");
  embed.addFields(active.map(task => ({
    name: `${task.status === "live" ? "🟢" : "🟡"} ${task.title}`,
    value: `${task.facility} · <@&${task.roleId}>\n<t:${Math.floor(task.startAt / 1000)}:F> – <t:${Math.floor(task.endAt / 1000)}:F>\nKadro: ${task.participants.length}/${task.capacity} · Yedek: ${task.waitlist.length}`,
    inline: false
  })));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function tournamentList(interaction, db) {
  const active = Object.values(tournamentsFor(db, interaction.guildId))
    .filter(tournament => isTournamentActive(tournament))
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, 10);
  if (!active.length) return interaction.reply({ content: "Şu anda açık veya devam eden turnuva yok.", ephemeral: true });
  const embed = new EmbedBuilder().setColor(0xf59e0b).setTitle("🏆 Turnuvalar");
  embed.addFields(active.map(tournament => ({
    name: `${tournament.status === "live" ? "🟢" : "🟡"} ${tournament.title}`,
    value: `<t:${Math.floor(tournament.startAt / 1000)}:F> · <t:${Math.floor(tournament.startAt / 1000)}:R>\nKadro: ${tournament.participants.length}/${tournament.capacity}${tournament.roleId ? ` · <@&${tournament.roleId}>` : ""}`,
    inline: false
  })));
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleTaskButton(interaction, db, save) {
  const [, action, taskId] = interaction.customId.split(":");
  const task = tasksFor(db, interaction.guildId)[taskId];
  if (!task) return interaction.reply({ content: "Bu görev artık bulunmuyor.", ephemeral: true });
  if (task.status !== "scheduled" || Date.now() >= task.startAt) {
    return interaction.reply({ content: "Görev kayıtları kapandı.", ephemeral: true });
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (action === "join") {
    if (!member.roles.cache.has(task.roleId)) {
      return interaction.reply({ content: `Bu göreve katılmak için <@&${task.roleId}> rolü gerekli. Önce /rp-rol-panel kullan.`, ephemeral: true });
    }
    if (task.participants.includes(member.id) || task.waitlist.includes(member.id)) {
      return interaction.reply({ content: "Bu görev için zaten kadroda veya yedek listesindesin.", ephemeral: true });
    }
    const conflict = findMemberConflict(db, interaction.guildId, member.id, task.startAt, task.endAt, "task", taskId);
    if (conflict) {
      return interaction.reply({ content: `Saat çakışması: **${conflict.title}** adlı ${conflict.kind} için zaten kaydın var.`, ephemeral: true });
    }
    if (task.participants.length < task.capacity) {
      task.participants.push(member.id);
      save();
      await updatePanel(interaction.client, interaction.guildId, task.channelId, task.messageId, taskEmbed(task), taskComponents(task));
      return interaction.reply({ content: `✅ **${task.title}** görevine kaydoldun.`, ephemeral: true });
    }
    if (task.waitlist.length >= 50) return interaction.reply({ content: "Yedek listesi dolu.", ephemeral: true });
    task.waitlist.push(member.id);
    save();
    await updatePanel(interaction.client, interaction.guildId, task.channelId, task.messageId, taskEmbed(task), taskComponents(task));
    return interaction.reply({ content: `Kadro dolu; **${task.title}** görevi için yedek listesine eklendin.`, ephemeral: true });
  }

  if (action === "leave") {
    const wasParticipant = task.participants.includes(member.id);
    const wasWaitlisted = task.waitlist.includes(member.id);
    if (!wasParticipant && !wasWaitlisted) {
      return interaction.reply({ content: "Bu görev için kaydın yok.", ephemeral: true });
    }
    task.participants = task.participants.filter(id => id !== member.id);
    task.waitlist = task.waitlist.filter(id => id !== member.id);
    if (wasParticipant && task.waitlist.length && task.participants.length < task.capacity) {
      const promoted = task.waitlist.shift();
      task.participants.push(promoted);
    }
    save();
    await updatePanel(interaction.client, interaction.guildId, task.channelId, task.messageId, taskEmbed(task), taskComponents(task));
    return interaction.reply({ content: "Görev kaydın kaldırıldı.", ephemeral: true });
  }
  return false;
}

async function handleTournamentButton(interaction, db, save) {
  const [, action, tournamentId] = interaction.customId.split(":");
  const tournament = tournamentsFor(db, interaction.guildId)[tournamentId];
  if (!tournament) return interaction.reply({ content: "Bu turnuva artık bulunmuyor.", ephemeral: true });
  if (tournament.status !== "open" || Date.now() >= tournament.startAt) {
    return interaction.reply({ content: "Turnuva kayıtları kapandı.", ephemeral: true });
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (action === "join") {
    if (tournament.roleId && !member.roles.cache.has(tournament.roleId)) {
      return interaction.reply({ content: `Bu turnuvaya katılmak için <@&${tournament.roleId}> rolü gerekli.`, ephemeral: true });
    }
    if (tournament.participants.includes(member.id)) {
      return interaction.reply({ content: "Bu turnuvaya zaten kayıtlısın.", ephemeral: true });
    }
    if (tournament.participants.length >= tournament.capacity) {
      return interaction.reply({ content: "Turnuva kadrosu dolu.", ephemeral: true });
    }
    const conflict = findMemberConflict(
      db, interaction.guildId, member.id, tournament.startAt, tournament.endAt, "tournament", tournamentId
    );
    if (conflict) {
      return interaction.reply({ content: `Saat çakışması: **${conflict.title}** adlı ${conflict.kind} için zaten kaydın var.`, ephemeral: true });
    }
    tournament.participants.push(member.id);
    save();
    await updatePanel(interaction.client, interaction.guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
    return interaction.reply({ content: `🏆 **${tournament.title}** turnuvasına kaydoldun.`, ephemeral: true });
  }

  if (action === "leave") {
    if (!tournament.participants.includes(member.id)) {
      return interaction.reply({ content: "Bu turnuva için kaydın yok.", ephemeral: true });
    }
    tournament.participants = tournament.participants.filter(id => id !== member.id);
    save();
    await updatePanel(interaction.client, interaction.guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
    return interaction.reply({ content: "Turnuva kaydın kaldırıldı.", ephemeral: true });
  }
  return false;
}

async function refreshTimedEvents(client, db, save) {
  const now = Date.now();
  for (const [guildId, tasks] of Object.entries(db.tasks || {})) {
    for (const task of Object.values(tasks)) {
      if (!isTaskActive(task)) continue;
      const nextStatus = now >= task.endAt ? "completed" : now >= task.startAt ? "live" : "scheduled";
      if (nextStatus === task.status) continue;
      task.status = nextStatus;
      save();
      await updatePanel(client, guildId, task.channelId, task.messageId, taskEmbed(task), taskComponents(task));
      const notice = nextStatus === "live"
        ? new EmbedBuilder().setColor(0x35d07f).setTitle(`🟢 ${task.title} başladı`).setDescription(`${task.facility} görevi başladı. Bitiş: <t:${Math.floor(task.endAt / 1000)}:R>`)
        : new EmbedBuilder().setColor(0x8b5cf6).setTitle(`✅ ${task.title} tamamlandı`).setDescription(`Katılımcı: ${task.participants.length}/${task.capacity} · Yedek: ${task.waitlist.length}`);
      await announce(client, guildId, task.channelId, notice);
    }
  }

  for (const [guildId, tournaments] of Object.entries(db.tournaments || {})) {
    for (const tournament of Object.values(tournaments)) {
      if (tournament.status === "open" && now >= tournament.startAt) {
        if (tournament.participants.length < 2) {
          tournament.status = "cancelled";
          save();
          await updatePanel(client, guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
          await announce(client, guildId, tournament.channelId, new EmbedBuilder()
            .setColor(0xef4444).setTitle(`⛔ ${tournament.title} başlatılamadı`)
            .setDescription("Turnuvanın başlayabilmesi için en az 2 katılımcı gerekli."));
          continue;
        }
        tournament.status = "live";
        tournament.round = 1;
        buildTournamentRound(tournament, tournament.participants);
        save();
        await updatePanel(client, guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
        await announce(client, guildId, tournament.channelId, roundAnnouncement(tournament));
      } else if (tournament.status === "live" && now >= tournament.endAt) {
        tournament.status = "cancelled";
        save();
        await updatePanel(client, guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
        await announce(client, guildId, tournament.channelId, new EmbedBuilder()
          .setColor(0xef4444).setTitle(`⏱️ ${tournament.title} süresi doldu`)
          .setDescription("Turnuva süresi sona erdi; yetkililer yeni bir turnuva oluşturabilir."));
      }
    }
  }
}

function startStatusWorker(client, db, save) {
  if (statusWorker) clearInterval(statusWorker);
  statusWorker = setInterval(() => {
    refreshTimedEvents(client, db, save).catch(error => console.error("Zamanlı görevler güncellenemedi:", error));
  }, 15_000);
  statusWorker.unref?.();
  refreshTimedEvents(client, db, save).catch(error => console.error("Zamanlı görevler yüklenemedi:", error));
}

async function createTask(interaction, db, save) {
  if (!hasEventPermission(interaction)) {
    return interaction.reply({ content: "Görev oluşturmak için Etkinlikleri Yönet izni gerekli.", ephemeral: true });
  }
  const title = interaction.options.getString("baslik").trim();
  const facility = interaction.options.getString("tesis").trim();
  const role = interaction.options.getRole("rol");
  const startAt = parseDateTime(interaction.options.getString("baslangic"));
  const endAt = parseDateTime(interaction.options.getString("bitis"));
  const capacity = interaction.options.getInteger("kapasite");
  const timeError = validateTimeWindow(startAt, endAt);
  if (timeError) return interaction.reply({ content: timeError, ephemeral: true });
  if (role.id === interaction.guildId) {
    return interaction.reply({ content: "@everyone rolü görev rolü olarak kullanılamaz.", ephemeral: true });
  }
  const facilityKey = normalizeFacility(facility);
  const conflict = findFacilityConflict(db, interaction.guildId, facilityKey, startAt, endAt);
  if (conflict) {
    return interaction.reply({
      content: `Tesis çakışması: **${facility}**, **${conflict.title}** görevi için bu saatlerde ayrılmış.`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const task = {
    id: interaction.id,
    title,
    facility,
    facilityKey,
    roleId: role.id,
    startAt,
    endAt,
    capacity,
    participants: [],
    waitlist: [],
    status: "scheduled",
    createdBy: interaction.user.id,
    channelId: interaction.channelId,
    messageId: null
  };
  const message = await interaction.channel.send({
    embeds: [taskEmbed(task)],
    components: taskComponents(task)
  });
  task.messageId = message.id;
  tasksFor(db, interaction.guildId)[task.id] = task;
  save();
  return interaction.editReply({ content: `Görev planlandı: ${message.url}`, allowedMentions: { parse: [] } });
}

async function cancelTask(interaction, db, client, save) {
  if (!hasEventPermission(interaction)) {
    return interaction.reply({ content: "Görev iptal etmek için Etkinlikleri Yönet izni gerekli.", ephemeral: true });
  }
  const id = interaction.options.getString("gorev");
  const task = tasksFor(db, interaction.guildId)[id];
  if (!task || !isTaskActive(task)) return interaction.reply({ content: "İptal edilebilir görev bulunamadı.", ephemeral: true });
  task.status = "cancelled";
  save();
  await updatePanel(client, interaction.guildId, task.channelId, task.messageId, taskEmbed(task), taskComponents(task));
  await announce(client, interaction.guildId, task.channelId, new EmbedBuilder()
    .setColor(0xef4444).setTitle(`⛔ ${task.title} iptal edildi`)
    .setDescription(`Tesis: ${task.facility}. Katılımcılar görevden çıkarıldı.`));
  return interaction.reply({ content: `**${task.title}** görevi iptal edildi.`, ephemeral: true });
}

async function createTournament(interaction, db, save) {
  if (!hasEventPermission(interaction)) {
    return interaction.reply({ content: "Turnuva oluşturmak için Etkinlikleri Yönet izni gerekli.", ephemeral: true });
  }
  const title = interaction.options.getString("baslik").trim();
  const startAt = parseDateTime(interaction.options.getString("baslangic"));
  const durationMinutes = interaction.options.getInteger("dakika") || 120;
  const endAt = startAt ? startAt + durationMinutes * 60_000 : null;
  const capacity = interaction.options.getInteger("kapasite");
  const role = interaction.options.getRole("rol");
  const timeError = validateTimeWindow(startAt, endAt);
  if (timeError) return interaction.reply({ content: timeError, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const tournament = {
    id: interaction.id,
    title,
    startAt,
    endAt,
    durationMinutes,
    capacity,
    roleId: role?.id || null,
    participants: [],
    status: "open",
    round: 0,
    matches: [],
    autoAdvancePlayers: [],
    championId: null,
    createdBy: interaction.user.id,
    channelId: interaction.channelId,
    messageId: null
  };
  const message = await interaction.channel.send({
    embeds: [tournamentEmbed(tournament)],
    components: tournamentComponents(tournament)
  });
  tournament.messageId = message.id;
  tournamentsFor(db, interaction.guildId)[tournament.id] = tournament;
  save();
  return interaction.editReply({ content: `Turnuva planlandı: ${message.url}`, allowedMentions: { parse: [] } });
}

async function reportTournamentWinner(interaction, db, client, save) {
  if (!hasEventPermission(interaction)) {
    return interaction.reply({ content: "Maç sonucu bildirmek için Etkinlikleri Yönet izni gerekli.", ephemeral: true });
  }
  const tournamentId = interaction.options.getString("turnuva");
  const winner = interaction.options.getUser("kazanan");
  const tournament = tournamentsFor(db, interaction.guildId)[tournamentId];
  if (!tournament || tournament.status !== "live") {
    return interaction.reply({ content: "Devam eden turnuva bulunamadı.", ephemeral: true });
  }
  const match = tournament.matches.find(current =>
    !current.winnerId && (current.player1 === winner.id || current.player2 === winner.id)
  );
  if (!match) {
    return interaction.reply({ content: "Bu oyuncu mevcut turda sonuçlanmamış bir eşleşmede değil.", ephemeral: true });
  }
  match.winnerId = winner.id;
  let roundResult = null;
  if (tournament.matches.every(current => current.winnerId)) {
    const advancing = [...tournament.autoAdvancePlayers, ...tournament.matches.map(current => current.winnerId)];
    if (advancing.length === 1) {
      tournament.status = "completed";
      tournament.championId = advancing[0];
      tournament.matches = [];
      tournament.autoAdvancePlayers = [];
      roundResult = new EmbedBuilder()
        .setColor(0x35d07f)
        .setTitle(`🏆 ${tournament.title} şampiyonu belli oldu`)
        .setDescription(`Tebrikler <@${tournament.championId}>!`);
    } else {
      tournament.round += 1;
      buildTournamentRound(tournament, advancing);
      roundResult = roundAnnouncement(tournament);
    }
  }
  save();
  await updatePanel(client, interaction.guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
  if (roundResult) await announce(client, interaction.guildId, tournament.channelId, roundResult);
  return interaction.reply({ content: `${winner.username} eşleşmenin galibi olarak kaydedildi.`, ephemeral: true });
}

async function cancelTournament(interaction, db, client, save) {
  if (!hasEventPermission(interaction)) {
    return interaction.reply({ content: "Turnuva iptal etmek için Etkinlikleri Yönet izni gerekli.", ephemeral: true });
  }
  const id = interaction.options.getString("turnuva");
  const tournament = tournamentsFor(db, interaction.guildId)[id];
  if (!tournament || !isTournamentActive(tournament)) {
    return interaction.reply({ content: "İptal edilebilir turnuva bulunamadı.", ephemeral: true });
  }
  tournament.status = "cancelled";
  save();
  await updatePanel(client, interaction.guildId, tournament.channelId, tournament.messageId, tournamentEmbed(tournament), tournamentComponents(tournament));
  await announce(client, interaction.guildId, tournament.channelId, new EmbedBuilder()
    .setColor(0xef4444).setTitle(`⛔ ${tournament.title} iptal edildi`));
  return interaction.reply({ content: `**${tournament.title}** turnuvası iptal edildi.`, ephemeral: true });
}

async function handleAutocomplete(interaction, db) {
  const query = interaction.options.getFocused().toLocaleLowerCase("tr");
  if (interaction.commandName === "gorev-iptal") {
    const choices = Object.entries(tasksFor(db, interaction.guildId))
      .filter(([, task]) => isTaskActive(task) && task.title.toLocaleLowerCase("tr").includes(query))
      .slice(0, 25)
      .map(([id, task]) => ({ name: `${task.title} · ${task.facility}`.slice(0, 100), value: id }));
    await interaction.respond(choices);
    return true;
  }
  if (interaction.commandName === "turnuva-iptal" || interaction.commandName === "turnuva-sonuc") {
    const choices = Object.entries(tournamentsFor(db, interaction.guildId))
      .filter(([, tournament]) =>
        (interaction.commandName === "turnuva-sonuc" ? tournament.status === "live" : isTournamentActive(tournament)) &&
        tournament.title.toLocaleLowerCase("tr").includes(query)
      )
      .slice(0, 25)
      .map(([id, tournament]) => ({ name: tournament.title.slice(0, 100), value: id }));
    await interaction.respond(choices);
    return true;
  }
  return false;
}

async function handleSchedulingInteraction(interaction, context) {
  const { db, save, client } = context;
  if (interaction.isAutocomplete()) return handleAutocomplete(interaction, db);

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("gorev:")) return handleTaskButton(interaction, db, save);
    if (interaction.customId.startsWith("turnuva:")) return handleTournamentButton(interaction, db, save);
    return false;
  }
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === "gorev-kur") return createTask(interaction, db, save);
  if (interaction.commandName === "gorevler") return taskList(interaction, db);
  if (interaction.commandName === "gorev-iptal") return cancelTask(interaction, db, client, save);
  if (interaction.commandName === "turnuva-kur") return createTournament(interaction, db, save);
  if (interaction.commandName === "turnuvalar") return tournamentList(interaction, db);
  if (interaction.commandName === "turnuva-sonuc") return reportTournamentWinner(interaction, db, client, save);
  if (interaction.commandName === "turnuva-iptal") return cancelTournament(interaction, db, client, save);
  return false;
}

module.exports = {
  handleSchedulingInteraction,
  startStatusWorker
};
