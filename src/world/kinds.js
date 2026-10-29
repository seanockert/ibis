// Prop kinds for level data (src/levels/*.json): the name in a level to the class. Each class takes
// (physics, asset, def) and has a static footprint(def) for placement (place.js). A new prop needs both
// and an entry here.
import { Gate } from './gate.js';
import { Ball, Bin, Box, Cereal } from './props.js';
import { Sprinkler } from './sprinkler.js';
import { Stubbies } from './stubbies.js';

export const PROPS = { ball: Ball, bin: Bin, box: Box, cereal: Cereal, gate: Gate, sprinkler: Sprinkler, stubbies: Stubbies };
