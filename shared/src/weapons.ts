// Waffendefinitionen (Spec 9.2). Werte in Metern, Sekunden, Schadenspunkten.

export type WeaponSlot = 'melee' | 'pistol' | 'auto' | 'heavy' | 'throw' | 'special';
export type WeaponId = 'fists' | 'bat' | 'machete' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'molotov' | 'rocket';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  damage: number;
  /** Sekunden zwischen zwei Schüssen/Schlägen. */
  cooldown: number;
  range: number;
  /** Streuung in Radiant, Anzahl Projektile pro Schuss. */
  spread: number;
  pellets: number;
  /** Radius für Flächenschaden (0 = Einzelziel). */
  area: number;
  unlockLevel: number;
  price: number;
  ammoPrice: number;
  /** Magazin-/Munitionsgröße beim Kauf; 0 = unbegrenzt (Nahkampf). */
  ammoPack: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fäuste', slot: 'melee', damage: 8, cooldown: 0.35, range: 1.5, spread: 0, pellets: 1, area: 0, unlockLevel: 1, price: 0, ammoPrice: 0, ammoPack: 0 },
  bat: { id: 'bat', name: 'Baseballschläger', slot: 'melee', damage: 18, cooldown: 0.6, range: 2, spread: 0, pellets: 1, area: 0, unlockLevel: 2, price: 500, ammoPrice: 0, ammoPack: 0 },
  machete: { id: 'machete', name: 'Machete', slot: 'melee', damage: 22, cooldown: 0.55, range: 2, spread: 0, pellets: 1, area: 0, unlockLevel: 8, price: 1_500, ammoPrice: 0, ammoPack: 0 },
  pistol: { id: 'pistol', name: 'Pistole', slot: 'pistol', damage: 15, cooldown: 0.4, range: 25, spread: 0.03, pellets: 1, area: 0, unlockLevel: 3, price: 800, ammoPrice: 20, ammoPack: 24 },
  smg: { id: 'smg', name: 'Maschinenpistole', slot: 'auto', damage: 9, cooldown: 0.1, range: 20, spread: 0.07, pellets: 1, area: 0, unlockLevel: 10, price: 4_000, ammoPrice: 60, ammoPack: 60 },
  shotgun: { id: 'shotgun', name: 'Schrotflinte', slot: 'heavy', damage: 40, cooldown: 1.0, range: 10, spread: 0.22, pellets: 5, area: 0, unlockLevel: 15, price: 8_000, ammoPrice: 80, ammoPack: 12 },
  rifle: { id: 'rifle', name: 'Gewehr', slot: 'heavy', damage: 25, cooldown: 0.5, range: 40, spread: 0.01, pellets: 1, area: 0, unlockLevel: 20, price: 12_000, ammoPrice: 100, ammoPack: 20 },
  molotov: { id: 'molotov', name: 'Molotow-Cocktail', slot: 'throw', damage: 30, cooldown: 1.5, range: 15, spread: 0, pellets: 1, area: 4, unlockLevel: 12, price: 300, ammoPrice: 300, ammoPack: 1 },
  rocket: { id: 'rocket', name: 'Raketenwerfer', slot: 'special', damage: 150, cooldown: 3, range: 50, spread: 0, pellets: 1, area: 6, unlockLevel: 30, price: 25_000, ammoPrice: 500, ammoPack: 3 },
};

/** Maximal 4 Waffen gleichzeitig (ein Slot je Klasse), dazu 1 Wurfwaffen-Slot (Spec 9.2/15.1). */
export const CARRY_SLOTS: WeaponSlot[] = ['melee', 'pistol', 'auto', 'heavy', 'throw'];

/** Ziel-Einrasten: Kegel in Grad (Spec 9.1). */
export const AIM_ASSIST_CONE_DEG = 15;
