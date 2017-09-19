/**
 * Local conversations in the terminal (for testing).
 */

import * as basebot from './basebot';
import * as readline from 'readline';
import * as opal from 'opal';

/**
 * A conversation that interacts with the user in the terminal.
 */
class Conversation implements basebot.Conversation {
  constructor(
    public termbot: TerminalBot,
    public user: string,
  ) {}

  send(text: string) {
    this.termbot.print(text);
  }

  async recv() {
    this.termbot.rl.prompt();
    return await this.termbot.spool.wait(null);
  }

  namespace = "terminal";
}

type MessageHandler = (message: string) => void;

/**
 * A debugging bot that interacts via stdout/stdin.
 */
export class TerminalBot implements basebot.Bot {
  public rl: readline.ReadLine;
  public spool = new basebot.Spool<null, string>();
  public onconverse: basebot.ConversationHandler | null = null;

  /**
   * Wait for terminal input and dispatch it.
   */
  run(ctx: opal.Context) {
    this.rl = readline.createInterface(process.stdin, process.stdout);
    this.rl.setPrompt('>>> ');

    // Handle input.
    this.rl.prompt();
    this.rl.on('line', async (line: string) => {
      let text = line.trim();
      let fired = await this.spool.fire(
        ctx, this, null, text, text,
        () => new Conversation(this, "user"),
      );
      if (!fired) {
        this.rl.prompt();
      }
    });
  }

  /**
   * Print a line of dialogue to the console.
   */
  print(message: string) {
    process.stdout.write('<<< ' + message + '\n');
  }
}
