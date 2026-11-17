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
  // Club & Casino (shared/venues). Kosmetik: „Benutzen“ zieht das Outfit an bzw. aus (Einlass Club/Casino).
  free_drink: { id: 'free_drink', name: 'Freigetränk „Pink Static“', kind: 'consumable', stack: 3, price: 0, heal: 30, stamina: 50 },
  lucky_salt: { id: 'lucky_salt', name: 'Badesalz-Glücksbringer (wirkt nur dienstags)', kind: 'cosmetic', stack: 1, price: 0 },
  outfit_evening: { id: 'outfit_evening', name: 'Abendgarderobe „Palm Royale“', kind: 'cosmetic', stack: 1, price: 1500 },
  outfit_disco: { id: 'outfit_disco', name: 'Glitzer-Outfit „Dance Floor Heat“', kind: 'cosmetic', stack: 1, price: 0 },
  usb_stick: { id: 'usb_stick', name: 'Gestohlener USB-Stick (Neon Syndicate)', kind: 'quest', stack: 1, price: 0 },
  evidence: { id: 'evidence', name: 'Beweisfotos (Hinterzimmer Palm Royale)', kind: 'quest', stack: 3, price: 0 },
};

/** Kosmetik-Gegenstände, die als Outfit angezogen werden können (Einlassprüfung Club/Casino). */
export const OUTFIT_ITEMS = new Set(['outfit_evening', 'outfit_disco']);

export const BACKPACK_SLOTS = 8;
export const BACKPACK_SLOTS_MAX = 16;
