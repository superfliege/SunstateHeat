// Gegenstandstypen (Spec 15). Preise in Dollar.

export type ItemKind = 'consumable' | 'armor' | 'tool' | 'trade' | 'illegal' | 'cosmetic' | 'quest';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  stack: number;
  price: number;
  /** Wirkung beim Benutzen. */
  heal?: number;
  stamina?: number;
  armor?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  burger: { id: 'burger', name: 'Burger', kind: 'consumable', stack: 5, price: 15, heal: 25 },
  sandwich: { id: 'sandwich', name: 'Kubanisches Sandwich', kind: 'consumable', stack: 5, price: 25, heal: 40 },
  energy: { id: 'energy', name: 'Energydrink', kind: 'consumable', stack: 5, price: 20, stamina: 100 },
  medkit: { id: 'medkit', name: 'Verbandskasten', kind: 'consumable', stack: 3, price: 150, heal: 100 },
  vest_light: { id: 'vest_light', name: 'Leichte Weste', kind: 'armor', stack: 1, price: 300, armor: 50 },
  vest_heavy: { id: 'vest_heavy', name: 'Schwere Weste', kind: 'armor', stack: 1, price: 800, armor: 100 },
  toolbox: { id: 'toolbox', name: 'Werkzeugkasten', kind: 'tool', stack: 1, price: 200 },
  crowbar: { id: 'crowbar', name: 'Brecheisen', kind: 'tool', stack: 1, price: 120 },
  jewelry: { id: 'jewelry', name: 'Gestohlener Schmuck', kind: 'trade', stack: 10, price: 0 },
  parts: { id: 'parts', name: 'Ersatzteile', kind: 'trade', stack: 10, price: 0 },
  crate: { id: 'crate', name: 'Kiste mit unbekanntem Inhalt', kind: 'illegal', stack: 5, price: 0 },
};

export const BACKPACK_SLOTS = 8;
export const BACKPACK_SLOTS_MAX = 16;
