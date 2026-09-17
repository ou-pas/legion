// Discord bridge — outbound gateway websocket (nothing to expose publicly).
// Blocking questions arrive as messages with buttons; free-text answers go through a
// modal (no privileged "message content" intent needed). Answers resume the session.
import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type TextChannel,
} from "discord.js";
import { answerInbox, registerNotifier, type InboxCreated } from "../inbox/inbox.js";
import { createLogger } from "../shared/log.js";

// The bridge state (absent, connected, login refused) is read in the terminal at boot; what gets
// read later is the announced inbox entry, which `inbox/notifiers.ts` already records.
const log = createLogger("discord");

export function startDiscord(): void {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !channelId) {
    log.info("disabled (DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID missing)");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("clientReady", () => log.info("connected", { tag: client.user?.tag }));
  // discord.js v14 emits "ready"; v15 renames it — listen to both, harmless.
  client.once("ready", () => log.info("ready", { tag: client.user?.tag }));

  async function channel(): Promise<TextChannel | null> {
    try {
      const ch = await client.channels.fetch(channelId!);
      return ch?.isTextBased() ? (ch as TextChannel) : null;
    } catch {
      return null;
    }
  }

  registerNotifier({
    async notifyInbox(msg: InboxCreated) {
      const ch = await channel();
      if (!ch) return;
      if (!msg.blocking) {
        await ch.send(`ℹ️ **${msg.agentName}** · ${msg.taskName}\n${msg.body.slice(0, 1800)}`);
        return;
      }
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      if (msg.kind === "choice" && msg.choices) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (const c of msg.choices.slice(0, 5))
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`inbox:${msg.id}:${c.id}`)
              .setLabel(c.label.slice(0, 80))
              .setStyle(ButtonStyle.Primary),
          );
        rows.push(row);
      } else {
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`inboxmodal:${msg.id}`)
              .setLabel("Answer…")
              .setStyle(ButtonStyle.Primary),
          ),
        );
      }
      await ch.send({
        content: `✋ **${msg.agentName}** is waiting for your decision · *${msg.taskName}*\n${msg.body.slice(0, 1800)}`,
        components: rows,
      });
    },
    async notifyText(text: string) {
      const ch = await channel();
      if (ch) await ch.send(text.slice(0, 1900)).catch(() => {});
    },
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        // ids are sanitized server-side, but parse defensively anyway (review #9)
        const parts = interaction.customId.split(":");
        const kind = parts[0];
        const inboxId = parts[1];
        const choiceId = parts.slice(2).join(":");
        if (kind === "inbox" && inboxId && choiceId) {
          const answer = await answerInbox(inboxId, { choiceId });
          await interaction.update({
            content: `${interaction.message.content}\n\n✅ **Answered: ${answer}** — session restarted.`,
            components: [],
          });
        } else if (kind === "inboxmodal" && inboxId) {
          const modal = new ModalBuilder()
            .setCustomId(`inboxanswer:${inboxId}`)
            .setTitle("Answer the agent");
          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("answer")
                .setLabel("Your answer")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true),
            ),
          );
          await interaction.showModal(modal);
        }
      } else if (interaction.isModalSubmit()) {
        const [kind, inboxId] = interaction.customId.split(":");
        if (kind === "inboxanswer" && inboxId) {
          const text = interaction.fields.getTextInputValue("answer");
          await answerInbox(inboxId, { text });
          await interaction.reply({
            content: "✅ Answer delivered — session restarted.",
            ephemeral: true,
          });
        }
      }
    } catch (err) {
      const message = `⚠️ ${String((err as Error).message)}`;
      if (interaction.isRepliable())
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  });

  client
    .login(token)
    .catch((err) => log.error("login refused", { error: String(err?.message ?? err) }));
}
