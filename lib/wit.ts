/**
 * Utilities for interacting with the Wit API.
 */

import * as node_wit from 'node-wit';

export interface Entity {
  confidence: number;
  value: string;
  [key: string]: any;
}

/**
 * Get an Entity from a response by its name (or null if no such entity exists).
 */
export function getEntity(res: node_wit.MessageResponse,
                          name: string): Entity | null {
  for (let res_name in res.entities) {
    let entities: Entity[] = res.entities[name];
    if (res_name === name) {
      return entities[0];
    }
  }
  return null;
}

/**
 * Get the value of an entity in the response by its name.
 */
export function entityValue(res: node_wit.MessageResponse,
                            name: string): string | null {
  let entity = getEntity(res, name);
  if (entity) {
    return entity.value;
  } else {
    return null;
  }
}
