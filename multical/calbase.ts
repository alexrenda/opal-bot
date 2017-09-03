/**
 * Base structures common to any calendar API backend.
 */
import { Moment } from 'moment';
import * as opal from 'opal';

/**
 * A calendar event.
 */
export interface Event {
  title: string;
  start: Moment;
  end: Moment;
}

class EventCollection extends opal.ExternalCollection<Event> {
  constructor (world: opal.World, private readonly cal: Calendar) {
    super(world);
  }

  async send(node: opal.PSet.Node<Event>, ops: opal.PSet.Operation<Event>[]) {
    let edit = new opal.Edit<Event>(ops);
    edit.foreach({
      add: async (event: Event) => {
        node = opal.PSet.add(node, event);
        await this.cal.scheduleEventImpl(event).catch((e) => {
          console.log(`got error: ${e}, ${e.stack}`);
        });;
      },
      delete: async (event: Event) => {
        node = opal.PSet.del(node, event);
      },
    });
    this.cal.resetBuffer();
    return node;
  }
}

/**
 * A set of calendar events.
 */
export abstract class Calendar {
  private eventBuffer: opal.Collection<Event>;

  constructor() {
    this.resetBuffer();
  }

  resetBuffer() {
    this.eventBuffer = opal.ctx.collection(
      (world: opal.World) => new EventCollection(world, this));
  }

  public async getEvents(start: Moment, end: Moment): Promise<Event[]> {
    let events = await this.getEventsImpl(start, end);
    events.concat(Array.from(opal.ctx.view(this.eventBuffer)));
    return events;
  }

  public async scheduleEvent(event: Event): Promise<boolean>{
    console.log(`Fake scheduler:`);
    console.log(event);
    opal.ctx.add(this.eventBuffer, event);
    return true;
  }

  abstract getEventsImpl(start: Moment, end: Moment): Promise<Event[]>;
  abstract scheduleEventImpl(event: Event): Promise<boolean>;
}
