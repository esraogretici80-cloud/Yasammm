require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionFlagsBits, Events
} = require("discord.js");

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN eksik. .env.example dosyasını .env olarak kopyalayıp doldur.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});
const DATA_FILE = path.join(__dirname, "data.json");
let db = { events: {}, warnings: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
} catch (e) { console.error("data.json okunamadı; yeni veri deposu kullanılacak.", e); }
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function getEvent(guildId) { return db.events[guildId] || null; }
function setEvent(guildId, event) { db.events[guildId] = event; save(); }
function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h} sa ${m} dk ${s} sn`;
}
function eventEmbed(ev) {
  const confirmed = ev.attendees.length;
  const reserve = ev.waitlist.length;
  const status = ev.status === "countdown" ? "🟠 Geri sayım" :
    ev.status === "live" ? "🟢 RP DEVAM EDİYOR" :
    ev.status === "ended" ? "⚫ Bitti" : "🔵 Katılım açık";
  return new EmbedBuilder()
    .setColor(ev.status === "live" ? 0x35d07f : 0x8b5cf6)
    .setTitle(`🏡 ${ev.title}`)
    .setDescription(ev.description || "Brookhaven roleplay etkinliği. Katılmak için aşağıdaki butonları kullan.")
    .addFields(
      { name: "📅 Tarih / Saat", value: ev.date, inline: true },
      { name: "📌 Durum", value: status, inline: true },
      { name: "👥 Kadro", value: `${confirmed}/${ev.capacity}`, inline: true },
      { name: "🪑 Yedek", value: `${reserve}`, inline: true },
      { name: "📝 Kayıt", value: ev.registrationOpen ? "Açık" : "Kapalı", inline: true },
      { name: "⏱️ Sayaç", value: ev.startedAt ? fmtDuration((ev.endedAt || Date.now()) - ev.startedAt) : "Henüz başlamadı", inline: true }
    )
    .setFooter({ text: "Brookhaven RP Manager • Kurallara uy, rolünü yap, eğlen!" })
    .setTimestamp();
}
function eventButtons(ev) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rp_join").setLabel("Katılıyorum").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(!ev.registrationOpen || ev.status === "ended"),
    new ButtonBuilder().setCustomId("rp_leave").setLabel("Ayrılıyorum").setEmoji("🚪").setStyle(ButtonStyle.Secondary).setDisabled(ev.status === "ended"),
    new ButtonBuilder().setCustomId("rp_wait").setLabel("Yedek liste").setEmoji("🪑").setStyle(ButtonStyle.Primary).setDisabled(!ev.registrationOpen || ev.status === "ended")
  );
}
async function updatePanel(guild, ev) {
  if (!ev.channelId || !ev.messageId) return;
  try {
    const channel = await guild.channels.fetch(ev.channelId);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(ev.messageId);
    await message.edit({ embeds: [eventEmbed(ev)], components: [eventButtons(ev)] });
  } catch (e) { console.warn("RP paneli güncellenemedi:", e.message); }
}
async function logMod(guild, text) {
  const id = process.env.MOD_LOG_CHANNEL_ID;
  if (!id) return;
  try {
    const ch = await guild.channels.fetch(id);
    if (ch?.isTextBased()) await ch.send({ content: text });
  } catch (e) { console.warn("Mod log gönderilemedi:", e.message); }
}
function isModerator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

client.once(Events.ClientReady, c => console.log(`Giriş yapıldı: ${c.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      const ev = getEvent(interaction.guildId);
      if (!ev || ev.status === "ended") return interaction.reply({ content: "Şu anda aktif bir RP kaydı bulunmuyor.", ephemeral: true });
      const id = interaction.user.id;
      if (!ev.registrationOpen && interaction.customId !== "rp_leave") {
        return interaction.reply({ content: "Kayıtlar şu anda kapalı.", ephemeral: true });
      }
      if (interaction.customId === "rp_join") {
        if (ev.attendees.includes(id)) return interaction.reply({ content: "Zaten katılımcı listesindesin.", ephemeral: true });
        if (ev.waitlist.includes(id)) ev.waitlist = ev.waitlist.filter(x => x !== id);
        if (ev.attendees.length >= ev.capacity) {
          ev.waitlist.push(id); save();
          await updatePanel(interaction.guild, ev);
          return interaction.reply({ content: "Kadro dolu! Yedek listesine eklendin.", ephemeral: true });
        }
        ev.attendees.push(id); save();
        await updatePanel(interaction.guild, ev);
        return interaction.reply({ content: "Katılımın kaydedildi. RP duyurularını takip et!", ephemeral: true });
      }
      if (interaction.customId === "rp_wait") {
        if (ev.attendees.includes(id) || ev.waitlist.includes(id)) return interaction.reply({ content: "Zaten kadroda veya yedek listesindesin.", ephemeral: true });
        ev.waitlist.push(id); save();
        await updatePanel(interaction.guild, ev);
        return interaction.reply({ content: "Yedek listesine eklendin.", ephemeral: true });
      }
      if (interaction.customId === "rp_leave") {
        ev.attendees = ev.attendees.filter(x => x !== id);
        ev.waitlist = ev.waitlist.filter(x => x !== id);
        if (ev.registrationOpen && ev.waitlist.length && ev.attendees.length < ev.capacity) {
          ev.attendees.push(ev.waitlist.shift());
        }
        save(); await updatePanel(interaction.guild, ev);
        return interaction.reply({ content: "Katılım durumun güncellendi.", ephemeral: true });
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, channel } = interaction;

    if (commandName === "rp-kur") {
      const ev = {
        title: interaction.options.getString("baslik"),
        date: interaction.options.getString("tarih"),
        capacity: interaction.options.getInteger("kapasite"),
        description: interaction.options.getString("aciklama") || "",
        attendees: [], waitlist: [], registrationOpen: true, status: "open",
        createdBy: interaction.user.id, createdAt: Date.now(),
        channelId: channel.id, messageId: null, startedAt: null, endedAt: null
      };
      const msg = await channel.send({ embeds: [eventEmbed(ev)], components: [eventButtons(ev)] });
      ev.messageId = msg.id; setEvent(guild.id, ev);
      return interaction.reply({ content: `RP katılım paneli oluşturuldu: ${msg.url}`, ephemeral: true });
    }

    if (commandName === "rp-baslat") {
      const ev = getEvent(guild.id);
      if (!ev || ev.status === "ended") return interaction.reply({ content: "Önce /rp-kur ile etkinlik oluştur.", ephemeral: true });
      if (ev.status === "live") return interaction.reply({ content: "RP zaten başladı.", ephemeral: true });
      ev.status = "countdown"; ev.countdownAt = Date.now(); setEvent(guild.id, ev);
      await updatePanel(guild, ev);
      await interaction.reply({ content: "⏳ 5 dakikalık geri sayım başladı. 5 dakika sonra RP otomatik olarak canlı duruma geçecek.", ephemeral: true });
      const guildId = guild.id;
      setTimeout(async () => {
        const current = getEvent(guildId);
        if (!current || current.status !== "countdown") return;
        current.status = "live"; current.startedAt = Date.now(); setEvent(guildId, current);
        const g = await client.guilds.fetch(guildId).catch(() => null);
        if (g) {
          await updatePanel(g, current);
          const ch = await g.channels.fetch(current.channelId).catch(() => null);
          if (ch?.isTextBased()) ch.send(`🚨 **${current.title} başladı!** Kadro: ${current.attendees.length}/${current.capacity}. İyi RP!`);
        }
      }, 5 * 60 * 1000);
      return;
    }

    if (commandName === "rp-sayac") {
      const ev = getEvent(guild.id);
      if (!ev) return interaction.reply({ content: "Henüz RP oluşturulmamış. /rp-kur kullan.", ephemeral: true });
      const elapsed = ev.startedAt ? fmtDuration((ev.endedAt || Date.now()) - ev.startedAt) : "Henüz başlamadı";
      return interaction.reply({ embeds: [eventEmbed(ev)], content: `⏱️ Geçen süre: **${elapsed}**`, ephemeral: true });
    }

    if (commandName === "rp-bitir") {
      const ev = getEvent(guild.id);
      if (!ev || ev.status === "ended") return interaction.reply({ content: "Bitirilecek aktif RP yok.", ephemeral: true });
      ev.status = "ended"; ev.registrationOpen = false; ev.endedAt = ev.startedAt ? Date.now() : null; setEvent(guild.id, ev);
      await updatePanel(guild, ev);
      const report = `🏁 **${ev.title} bitti!**\nKatılımcı: ${ev.attendees.length}/${ev.capacity}\nYedek: ${ev.waitlist.length}\nSüre: ${ev.startedAt ? fmtDuration(ev.endedAt - ev.startedAt) : "Başlamadan bitirildi."}`;
      await interaction.reply({ content: report });
      await logMod(guild, `📋 RP raporu • ${report}`);
      return;
    }

    if (commandName === "rp-kayit-kapat" || commandName === "rp-kayit-ac") {
      const ev = getEvent(guild.id);
      if (!ev || ev.status === "ended") return interaction.reply({ content: "Aktif RP bulunamadı.", ephemeral: true });
      ev.registrationOpen = commandName === "rp-kayit-ac"; setEvent(guild.id, ev);
      await updatePanel(guild, ev);
      return interaction.reply({ content: ev.registrationOpen ? "✅ RP kayıtları açıldı." : "🔒 RP kayıtları kapatıldı." });
    }

    if (commandName === "rp-kadro") {
      const ev = getEvent(guild.id);
      if (!ev) return interaction.reply({ content: "Aktif RP yok.", ephemeral: true });
      const names = async ids => {
        if (!ids.length) return "—";
        const out = [];
        for (const id of ids.slice(0, 40)) {
          const user = await client.users.fetch(id).catch(() => null);
          out.push(user ? `• ${user.username} (<@${id}>)` : `• <@${id}>`);
        }
        return out.join("\n");
      };
      const embed = new EmbedBuilder().setTitle(`👥 ${ev.title} — Kadro`).setColor(0x8b5cf6)
        .addFields(
          { name: `Katılımcılar (${ev.attendees.length}/${ev.capacity})`, value: await names(ev.attendees) },
          { name: `Yedekler (${ev.waitlist.length})`, value: await names(ev.waitlist) }
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (["uyar", "timeout", "kick", "ban"].includes(commandName)) {
      const user = interaction.options.getUser("uye");
      const reason = interaction.options.getString("sebep");
      if (user.id === interaction.user.id) return interaction.reply({ content: "Kendine bu işlemi uygulayamazsın.", ephemeral: true });
      if (user.id === client.user.id) return interaction.reply({ content: "Bot üzerinde bu işlem yapılamaz.", ephemeral: true });
      if (commandName === "uyar") {
        db.warnings[user.id] ||= [];
        db.warnings[user.id].push({ guildId: guild.id, moderator: interaction.user.id, reason, at: Date.now() }); save();
        await logMod(guild, `⚠️ Uyarı: <@${user.id}> • Yetkili: ${interaction.user} • Sebep: ${reason}`);
        return interaction.reply({ content: `⚠️ <@${user.id}> uyarıldı. Sebep: **${reason}**`, allowedMentions: { users: [] } });
      }
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "Üye bu sunucuda bulunamadı.", ephemeral: true });
      if (member.id === guild.ownerId || member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ content: "Rol hiyerarşisi nedeniyle bu üyeye işlem yapamazsın.", ephemeral: true });
      }
      if (commandName === "timeout") {
        const mins = interaction.options.getInteger("dakika");
        await member.timeout(mins * 60 * 1000, reason);
        await logMod(guild, `🔇 Timeout: ${user.tag} • ${mins} dk • Yetkili: ${interaction.user.tag} • ${reason}`);
        return interaction.reply({ content: `🔇 ${user} ${mins} dakika susturuldu. Sebep: ${reason}` });
      }
      if (commandName === "kick") {
        await member.kick(reason);
        await logMod(guild, `👢 Kick: ${user.tag} • Yetkili: ${interaction.user.tag} • ${reason}`);
        return interaction.reply({ content: `👢 ${user.tag} sunucudan atıldı. Sebep: ${reason}` });
      }
      if (commandName === "ban") {
        await member.ban({ reason });
        await logMod(guild, `⛔ Ban: ${user.tag} • Yetkili: ${interaction.user.tag} • ${reason}`);
        return interaction.reply({ content: `⛔ ${user.tag} yasaklandı. Sebep: ${reason}` });
      }
    }

    if (commandName === "oda-kapat" || commandName === "oda-ac") {
      const everyone = guild.roles.everyone;
      if (!channel.permissionOverwrites) return interaction.reply({ content: "Bu kanal için izinler değiştirilemiyor.", ephemeral: true });
      if (commandName === "oda-kapat") {
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: false, SendMessages: false }, { reason: `Oda kapatıldı: ${interaction.user.tag}` });
        return interaction.reply({ content: `🔒 ${channel} için @everyone erişimi kapatıldı. Bot/yetkili izinlerini kontrol etmeyi unutma.` , ephemeral: true });
      } else {
        await channel.permissionOverwrites.edit(everyone, { ViewChannel: true, SendMessages: true }, { reason: `Oda açıldı: ${interaction.user.tag}` });
        return interaction.reply({ content: `🔓 ${channel} için @everyone erişimi açıldı.`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    const msg = "Bir hata oluştu. Bot izinlerini ve rol sıralamasını kontrol et.";
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
