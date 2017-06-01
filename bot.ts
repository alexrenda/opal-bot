import * as child_process from 'child_process';
import { Wit } from 'node-wit';
import * as util from 'util';
import * as fetch from 'node-fetch';

import { Bot, Message } from './lib/slackbot';
import * as wit from './lib/wit';

const BOT_TOKEN = process.env['SLACK_BOT_TOKEN'] || '';
const WIT_TOKEN = process.env['WIT_ACCESS_TOKEN'] || '';
const STATUS_CHAN = 'bot-status';

/**
 * Get the current git revision string for a repository.
 */
function git_summary(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    child_process.exec('git rev-parse --short HEAD', { cwd: path },
                       (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Handle a direct interaction.
 */
async function interact(message: string, reply: (message: string) => void) {
  let res = await wit_client.message(message, {});
  console.log(`Wit parse: ${util.inspect(res, { depth: undefined })}`);

  if (wit.getEntity(res, "greetings")) {
    reply("hi!");
    return;
  } else {
    let intent = wit.entityValue(res, "intent");
    if (intent === "show_calendar") {
      reply("let's get your calendar!");
      return;
    } else if (intent === "schedule_meeting") {
      reply("let's schedule a meeting!");
      return;
    }
  }

  // Unhandled message.
  reply(':confused: :grey_question:');
}

const wit_client = new Wit({
  accessToken: WIT_TOKEN,
});

const bot = new Bot(BOT_TOKEN);

bot.on("ready", async () => {
  console.log(`I'm ${bot.self.name} on ${bot.team.name}`);

  // Indicate that we've started.
  let status_channel = bot.channel(STATUS_CHAN);
  if (status_channel) {
    let commit = await git_summary(__dirname);
    bot.send(`:wave: @ ${commit}`, status_channel.id);
  }
});

bot.on("message", async (message) => {
  // Parse private messages.
  if (bot.ims.get(message.channel)) {
    console.log(`${message.user}: ${message.text}`);
    await interact(message.text, txt => bot.send(txt, message.channel));
  }
});

bot.start();
