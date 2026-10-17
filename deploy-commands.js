require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("rp-kur")
    .setDescription("Yeni Brookhaven RP etkinliği ve katılım paneli oluşturur.")
    .addStringOption(o => o.setName("baslik").setDescription("RP başlığı").setRequired(true))
    .addStringOption(o => o.setName("tarih").setDescription("Tarih ve saat (ör. Bugün 20:30)").setRequired(true))
    .addIntegerOption(o => o.setName("kapasite").setDescription("Maksimum oyuncu sayısı").setMinValue(2).setMaxValue(100).setRequired(true))
    .addStringOption(o => o.setName("aciklama").setDescription("Kısa açıklama").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
  new SlashCommandBuilder().setName("rp-baslat").setDescription("Aktif RP için geri sayımı başlatır (5 dakika).").setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
  new SlashCommandBuilder().setName("rp-sayac").setDescription("Aktif RP durumunu ve sayaç bilgisini gösterir."),
  new SlashCommandBuilder().setName("rp-bitir").setDescription("Aktif RP etkinliğini bitirir.").setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
  new SlashCommandBuilder().setName("rp-kayit-kapat").setDescription("Aktif RP katılım kayıtlarını kapatır.").setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
  new SlashCommandBuilder().setName("rp-kayit-ac").setDescription("Aktif RP katılım kayıtlarını açar.").setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
  new SlashCommandBuilder().setName("rp-kadro").setDescription("Aktif RP katılımcılarını ve yedekleri listeler."),
  new SlashCommandBuilder()
    .setName("uyar")
    .setDescription("Bir üyeye resmi uyarı verir.")
    .addUserOption(o => o.setName("uye").setDescription("Uyarılacak üye").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Uyarı sebebi").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Bir üyeyi belirli dakika boyunca susturur.")
    .addUserOption(o => o.setName("uye").setDescription("Susturulacak üye").setRequired(true))
    .addIntegerOption(o => o.setName("dakika").setDescription("Süre (1-10080 dakika)").setMinValue(1).setMaxValue(10080).setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Bir üyeyi sunucudan atar.")
    .addUserOption(o => o.setName("uye").setDescription("Atılacak üye").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bir üyeyi sunucudan yasaklar.")
    .addUserOption(o => o.setName("uye").setDescription("Yasaklanacak üye").setRequired(true))
    .addStringOption(o => o.setName("sebep").setDescription("Sebep").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName("oda-kapat")
    .setDescription("Bu Discord kanalında @everyone mesaj yazma/kanalı görme iznini kapatır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName("oda-ac")
    .setDescription("Bu Discord kanalının @everyone erişimini tekrar açar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map(c => c.toJSON());

async function main() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    throw new Error(".env dosyasında DISCORD_TOKEN, CLIENT_ID ve GUILD_ID doldurulmalı.");
  }
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("Slash komutları test sunucusuna yüklendi.");
}
main().catch(err => { console.error(err); process.exit(1); });
