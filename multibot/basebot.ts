import * as opal from 'opal';

/**
 * Abstract interface for bot-like communication.
 */

/**
 * An ongoing textual interaction with a single user.
 */
export interface Conversation {
  /**
   * Send a message in the conversation.
   */
  send(text: string): void;

  /**
   * Wait for a message in this conversation.
   */
  recv(): Promise<string>;

  /**
   * A string identifying the user that this conversation is with.
   */
  user: string;

  /**
   * A namespace indicating the scope of user IDs (e.g., the service where the
   * user is logged in). Two users with the same user ID in different
   * namespaces are different users.
   */
  namespace: string;
}

/**
 * Conversation handlers get an initial message and an object to represent
 * the continuing conversation.
 */
export type ConversationHandler =
  (ctx: opal.Context, message: string, conv: Conversation) => Promise<void>;

/**
 * A bot connection dispatches to conversation handlers.
 */
export interface Bot {
  /**
   * Register a callback for new conversations.
   */
  onconverse: ConversationHandler | null;
}

/**
 * A repository for threads of conversation waiting on events, M, on channels
 * identified by keys, K.
 */
export class Spool<K, M> {
  private waiters: [K, (message: M) => void][] = [];

  /**
   * Await a message on a given channel.
   */
  wait(key: K): Promise<M> {
    return new Promise((resolve, reject) => {
      this.waiters.push([key, resolve]);
    });
  }

  /**
   * Dispatch a message on a channel. If there is a callback waiting for this
   * message, pop and return it. Otherwise, return null.
   */
  dispatch(key: K, message: M): ((message: M) => void) | null {
    // Check whether there's a callback waiting for this message and,
    // if so, remove it.
    for (let [i, [k, cbk]] of this.waiters.entries()) {
      if (k === key) {
        this.waiters.splice(i, 1);
        return cbk;
      }
    }

    // Otherwise, indicate that this was unhandled.
    return null;
  }

  /**
   * Invoke the appropriate callback for a message, or the `onconverse`
   * handler for new conversations. Return a flag indicating whether a
   * spooled callback was fired.
   */
  async fire(ctx: opal.Context, bot: Bot, key: K, message: M,
             text: string, mkconv: () => Conversation): Promise<boolean> {
    let cbk = this.dispatch(key, message);
    if (cbk) {
      // Existing conversation.
      cbk(message);
      return true;
    } else if (bot.onconverse) {
      // New conversation.
      await bot.onconverse(ctx, text, mkconv());
    }
    return false;
  }
}
