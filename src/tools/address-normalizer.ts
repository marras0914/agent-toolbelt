import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  address: z.string().min(1).max(500).describe("The address string to normalize"),
  includeComponents: z
    .boolean()
    .default(true)
    .describe("Include parsed address components in the response"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Abbreviation maps (USPS standard) -----
const STREET_TYPES: Record<string, string> = {
  allee: "ALY", alley: "ALY", ally: "ALY", aly: "ALY",
  anex: "ANX", annex: "ANX", annx: "ANX", anx: "ANX",
  arc: "ARC", arcade: "ARC",
  av: "AVE", ave: "AVE", aven: "AVE", avenu: "AVE", avenue: "AVE", avn: "AVE", avnue: "AVE",
  bayoo: "BYU", bayou: "BYU",
  bch: "BCH", beach: "BCH",
  bend: "BND", bnd: "BND",
  blf: "BLF", bluff: "BLF", bluf: "BLF",
  blfs: "BLFS", bluffs: "BLFS",
  bot: "BTM", bottm: "BTM", bottom: "BTM", btm: "BTM",
  blvd: "BLVD", boul: "BLVD", boulevard: "BLVD", boulv: "BLVD",
  br: "BR", brnch: "BR", branch: "BR",
  brdge: "BRG", brg: "BRG", bridge: "BRG",
  brk: "BRK", brook: "BRK",
  bypa: "BYP", bypas: "BYP", bypass: "BYP", byps: "BYP", byp: "BYP",
  camp: "CP", cp: "CP", cmp: "CP",
  canyn: "CYN", canyon: "CYN", cnyn: "CYN", cyn: "CYN",
  cape: "CPE", cpe: "CPE",
  causeway: "CSWY", causwa: "CSWY", cswy: "CSWY",
  cen: "CTR", cent: "CTR", center: "CTR", centr: "CTR", centre: "CTR", cnter: "CTR", cntr: "CTR", ctr: "CTR",
  cir: "CIR", circ: "CIR", circl: "CIR", circle: "CIR", crcl: "CIR", crcle: "CIR",
  clf: "CLF", clfs: "CLFS", cliff: "CLF", cliffs: "CLFS",
  clb: "CLB", club: "CLB",
  common: "CMN", cmn: "CMN",
  cor: "COR", corner: "COR",
  cors: "CORS", corners: "CORS",
  course: "CRSE", crse: "CRSE",
  court: "CT", crt: "CT", ct: "CT",
  courts: "CTS", cts: "CTS",
  cove: "CV", cv: "CV",
  creek: "CRK", crk: "CRK",
  cres: "CRES", crescent: "CRES", crsent: "CRES", crsnt: "CRES",
  crossing: "XING", crssng: "XING", xing: "XING",
  dale: "DL", dl: "DL",
  dam: "DM", dm: "DM",
  div: "DV", divide: "DV", dv: "DV", dvd: "DV",
  dr: "DR", driv: "DR", drive: "DR", drv: "DR",
  est: "EST", estate: "EST",
  ests: "ESTS", estates: "ESTS",
  exp: "EXPY", expr: "EXPY", express: "EXPY", expressway: "EXPY", expw: "EXPY", expy: "EXPY",
  ext: "EXT", extension: "EXT", extn: "EXT", extnsn: "EXT",
  fall: "FALL",
  falls: "FLS", fls: "FLS",
  ferry: "FRY", frry: "FRY", fry: "FRY",
  field: "FLD", fld: "FLD",
  fields: "FLDS", flds: "FLDS",
  flat: "FLT", flt: "FLT",
  flats: "FLTS", flts: "FLTS",
  ford: "FRD", frd: "FRD",
  forest: "FRST", forests: "FRST", frst: "FRST",
  forg: "FRG", forge: "FRG", frg: "FRG",
  fork: "FRK", frk: "FRK",
  forks: "FRKS", frks: "FRKS",
  fort: "FT", frt: "FT", ft: "FT",
  freeway: "FWY", freewy: "FWY", frway: "FWY", frwy: "FWY", fwy: "FWY",
  garden: "GDN", gardn: "GDN", grden: "GDN", grdn: "GDN", gdn: "GDN",
  gardens: "GDNS", gdns: "GDNS", grdns: "GDNS",
  gateway: "GTWY", gatewy: "GTWY", gatway: "GTWY", gtway: "GTWY", gtwy: "GTWY",
  glen: "GLN", gln: "GLN",
  green: "GRN", grn: "GRN",
  grove: "GRV", grov: "GRV", grv: "GRV",
  harb: "HBR", harbor: "HBR", harbr: "HBR", hbr: "HBR", hrbor: "HBR",
  haven: "HVN", hvn: "HVN",
  hgts: "HTS", height: "HTS", heights: "HTS", hts: "HTS",
  highway: "HWY", highwy: "HWY", hiway: "HWY", hiwy: "HWY", hway: "HWY", hwy: "HWY",
  hill: "HL", hl: "HL",
  hills: "HLS", hls: "HLS",
  hllw: "HOLW", hollow: "HOLW", hollows: "HOLW", holw: "HOLW", holws: "HOLW",
  inlt: "INLT", inlet: "INLT",
  is: "IS", island: "IS", islnd: "IS",
  islands: "ISS", islnds: "ISS", iss: "ISS",
  isle: "ISLE", isles: "ISLE",
  jct: "JCT", jction: "JCT", jctn: "JCT", junction: "JCT", junctn: "JCT", juncton: "JCT",
  key: "KY", ky: "KY",
  keys: "KYS", kys: "KYS",
  knl: "KNL", knol: "KNL", knoll: "KNL",
  knls: "KNLS", knolls: "KNLS",
  lk: "LK", lake: "LK",
  lks: "LKS", lakes: "LKS",
  land: "LAND",
  lndg: "LNDG", landing: "LNDG", lndng: "LNDG",
  ln: "LN", lane: "LN",
  lgt: "LGT", light: "LGT",
  lgts: "LGTS", lights: "LGTS",
  lf: "LF", loaf: "LF",
  lck: "LCK", lock: "LCK",
  lcks: "LCKS", locks: "LCKS",
  ldg: "LDG", ldge: "LDG", lodg: "LDG", lodge: "LDG",
  loop: "LOOP", loops: "LOOP",
  mall: "MALL",
  mnr: "MNR", manor: "MNR",
  mnrs: "MNRS", manors: "MNRS",
  meadow: "MDW",
  mdw: "MDWS", mdws: "MDWS", meadows: "MDWS", medows: "MDWS",
  mews: "MEWS",
  mill: "ML", ml: "ML",
  mills: "MLS", mls: "MLS",
  missn: "MSN", msn: "MSN", mission: "MSN",
  motorway: "MTWY",
  mnt: "MT", mount: "MT", mt: "MT",
  mntain: "MTN", mntn: "MTN", mountain: "MTN", mountin: "MTN", mtin: "MTN", mtn: "MTN",
  mntns: "MTNS", mountains: "MTNS", mtns: "MTNS",
  nck: "NCK", neck: "NCK",
  orch: "ORCH", orchard: "ORCH", orchrd: "ORCH",
  oval: "OVAL", ovl: "OVAL",
  park: "PARK", prk: "PARK",
  parkway: "PKWY", parkwy: "PKWY", pkway: "PKWY", pkwy: "PKWY", pky: "PKWY",
  pass: "PASS",
  path: "PATH", paths: "PATH",
  pike: "PIKE", pikes: "PIKE",
  pine: "PNE",
  pines: "PNES", pnes: "PNES",
  pl: "PL", place: "PL",
  plain: "PLN", pln: "PLN",
  plains: "PLNS", plns: "PLNS",
  plaza: "PLZ", plz: "PLZ", plza: "PLZ",
  point: "PT", pt: "PT",
  points: "PTS", pts: "PTS",
  port: "PRT", prt: "PRT",
  ports: "PRTS", prts: "PRTS",
  pr: "PR", prairie: "PR", prr: "PR",
  rad: "RADL", radial: "RADL", radiel: "RADL", radl: "RADL",
  ramp: "RAMP",
  ranch: "RNCH", ranches: "RNCH", rnch: "RNCH", rnchs: "RNCH",
  rapid: "RPD", rpd: "RPD",
  rapids: "RPDS", rpds: "RPDS",
  rest: "RST", rst: "RST",
  rdg: "RDG", rdge: "RDG", ridge: "RDG",
  rdgs: "RDGS", ridges: "RDGS",
  riv: "RIV", river: "RIV", rvr: "RIV", rivr: "RIV",
  rd: "RD", road: "RD", roads: "RDS", rds: "RDS",
  route: "RTE",
  row: "ROW",
  rue: "RUE",
  run: "RUN",
  shl: "SHL", shoal: "SHL",
  shls: "SHLS", shoals: "SHLS",
  shoar: "SHR", shore: "SHR", shr: "SHR",
  shoars: "SHRS", shores: "SHRS", shrs: "SHRS",
  skyway: "SKWY",
  smt: "SMT", sumit: "SMT", sumitt: "SMT", summit: "SMT",
  spg: "SPG", spng: "SPG", spring: "SPG", sprng: "SPG",
  spgs: "SPGS", spngs: "SPGS", springs: "SPGS", sprngs: "SPGS",
  spur: "SPUR", spurs: "SPUR",
  sq: "SQ", sqr: "SQ", sqre: "SQ", squ: "SQ", square: "SQ",
  sqrs: "SQS", squares: "SQS",
  sta: "STA", station: "STA", statn: "STA", stn: "STA",
  stra: "STRA", strav: "STRA", straven: "STRA", stravenue: "STRA", stravn: "STRA", strvn: "STRA", strvnue: "STRA",
  stream: "STRM", streme: "STRM", strm: "STRM",
  st: "ST", str: "ST", street: "ST", strt: "ST",
  streets: "STS",
  ter: "TER", terr: "TER", terrace: "TER",
  throughway: "TRWY",
  trace: "TRCE", traces: "TRCE", trce: "TRCE",
  track: "TRAK", tracks: "TRAK", trak: "TRAK", trk: "TRAK", trks: "TRAK",
  trafficway: "TRFY",
  trail: "TRL", trails: "TRL", trl: "TRL", trls: "TRL",
  tunnel: "TUNL", tunl: "TUNL", tunls: "TUNL", tunnels: "TUNL", tunnl: "TUNL",
  tpke: "TPKE", trnpk: "TPKE", turnpike: "TPKE", turnpk: "TPKE",
  upas: "UPAS",
  un: "UN", union: "UN",
  unions: "UNS",
  valley: "VLY", vally: "VLY", vlly: "VLY", vly: "VLY",
  valleys: "VLYS", vlys: "VLYS",
  vdct: "VIA", via: "VIA", viadct: "VIA", viaduct: "VIA",
  view: "VW", vw: "VW",
  views: "VWS", vws: "VWS",
  vill: "VLG", villag: "VLG", village: "VLG", villg: "VLG", villiage: "VLG", vlg: "VLG",
  villages: "VLGS", vlgs: "VLGS",
  ville: "VL", vl: "VL",
  vis: "VIS", vist: "VIS", vista: "VIS", vst: "VIS", vsta: "VIS",
  walk: "WALK", walks: "WALK",
  wall: "WALL",
  wy: "WAY", way: "WAY",
  ways: "WAYS",
  well: "WL",
  wells: "WLS", wls: "WLS",
};

const SECONDARY_UNIT: Record<string, string> = {
  apartment: "APT", apt: "APT",
  basement: "BSMT", bsmt: "BSMT",
  building: "BLDG", bldg: "BLDG",
  department: "DEPT", dept: "DEPT",
  floor: "FL", fl: "FL",
  front: "FRNT", frnt: "FRNT",
  hangar: "HNGR", hngr: "HNGR",
  key: "KEY",
  lobby: "LBBY", lbby: "LBBY",
  lot: "LOT",
  lower: "LOWR", lowr: "LOWR",
  office: "OFC", ofc: "OFC",
  penthouse: "PH", ph: "PH",
  pier: "PIER",
  rear: "REAR",
  room: "RM", rm: "RM",
  side: "SIDE",
  slip: "SLIP",
  space: "SPC", spc: "SPC",
  stop: "STOP",
  suite: "STE", ste: "STE",
  trailer: "TRLR", trlr: "TRLR",
  unit: "UNIT",
  upper: "UPPR", uppr: "UPPR",
};

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "washington dc": "DC", "washington d.c.": "DC",
};

const DIRECTIONAL: Record<string, string> = {
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
  n: "N", s: "S", e: "E", w: "W",
  ne: "NE", nw: "NW", se: "SE", sw: "SW",
};

// ----- Parser -----
interface AddressComponents {
  streetNumber?: string;
  preDirectional?: string;
  streetName?: string;
  streetType?: string;
  postDirectional?: string;
  secondaryUnit?: string;
  secondaryNumber?: string;
  city?: string;
  state?: string;
  zip?: string;
  zip4?: string;
}

function parseAddress(input: string): { components: AddressComponents; normalized: string; confidence: "high" | "medium" | "low" } {
  // Clean input
  const raw = input.trim().replace(/\s+/g, " ").replace(/[.]/g, "");

  // Split on comma to separate street from city/state/zip
  const parts = raw.split(",").map((p) => p.trim());

  const components: AddressComponents = {};

  // Parse city/state/zip from last parts
  // Last part often: "TX 75001" or "TX 75001-1234" or "Texas 75001"
  // Second-to-last: city name
  if (parts.length >= 3) {
    components.city = parts[parts.length - 2];

    const stateZip = parts[parts.length - 1].trim();
    const stateZipMatch = stateZip.match(/^([A-Za-z\s]+)\s+(\d{5})(?:-(\d{4}))?$/);
    if (stateZipMatch) {
      const stateRaw = stateZipMatch[1].trim().toLowerCase();
      components.state = STATE_ABBR[stateRaw] || stateZipMatch[1].trim().toUpperCase();
      components.zip = stateZipMatch[2];
      if (stateZipMatch[3]) components.zip4 = stateZipMatch[3];
    } else {
      // Try just state abbreviation
      const stateOnly = stateZip.match(/^([A-Za-z]{2})$/);
      if (stateOnly) components.state = stateOnly[1].toUpperCase();
      else components.state = stateZip.toUpperCase();
    }
  } else if (parts.length === 2) {
    // Could be "City ST 12345" in second part
    const second = parts[1].trim();
    const cityStateZip = second.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-(\d{4}))?$/);
    if (cityStateZip) {
      components.city = cityStateZip[1].trim();
      components.state = cityStateZip[2].toUpperCase();
      components.zip = cityStateZip[3];
      if (cityStateZip[4]) components.zip4 = cityStateZip[4];
    } else {
      // Might just be city
      components.city = second;
    }
  }

  // Parse street line (first part)
  const streetLine = parts[0];
  const tokens = streetLine.split(/\s+/);

  // Street number (first token if numeric)
  let idx = 0;
  if (/^\d+[A-Za-z]?$/.test(tokens[0])) {
    components.streetNumber = tokens[0].toUpperCase();
    idx = 1;
  }

  // Pre-directional
  if (idx < tokens.length && DIRECTIONAL[tokens[idx].toLowerCase()]) {
    // Only treat as directional if the next token looks like a street name
    const maybeDir = DIRECTIONAL[tokens[idx].toLowerCase()];
    if (idx + 1 < tokens.length) {
      components.preDirectional = maybeDir;
      idx++;
    }
  }

  // Street type and name — scan remaining tokens for a street type suffix
  const remaining = tokens.slice(idx);
  let streetTypeIdx = -1;
  for (let i = remaining.length - 1; i >= 0; i--) {
    const t = remaining[i].toLowerCase();
    if (STREET_TYPES[t]) {
      streetTypeIdx = i;
      break;
    }
  }

  if (streetTypeIdx >= 0) {
    components.streetName = remaining.slice(0, streetTypeIdx).map((t) => {
      const d = DIRECTIONAL[t.toLowerCase()];
      return d || t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    }).join(" ");
    components.streetType = STREET_TYPES[remaining[streetTypeIdx].toLowerCase()];

    // Post-directional and secondary unit after street type
    const after = remaining.slice(streetTypeIdx + 1);
    let afterIdx = 0;

    if (afterIdx < after.length && DIRECTIONAL[after[afterIdx].toLowerCase()]) {
      components.postDirectional = DIRECTIONAL[after[afterIdx].toLowerCase()];
      afterIdx++;
    }

    // Secondary unit designator
    if (afterIdx < after.length) {
      const unitKey = after[afterIdx].toLowerCase();
      if (SECONDARY_UNIT[unitKey]) {
        components.secondaryUnit = SECONDARY_UNIT[unitKey];
        afterIdx++;
        if (afterIdx < after.length) {
          components.secondaryNumber = after[afterIdx].toUpperCase();
        }
      } else if (/^#/.test(after[afterIdx])) {
        components.secondaryUnit = "APT";
        components.secondaryNumber = after[afterIdx].replace("#", "").toUpperCase();
      }
    }
  } else {
    // No street type found — just use all remaining as street name
    components.streetName = remaining.join(" ");
  }

  // Capitalize city
  if (components.city) {
    components.city = components.city
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  // Build normalized string
  const lineParts: string[] = [];

  // Line 1: street
  const street = [
    components.streetNumber,
    components.preDirectional,
    components.streetName,
    components.streetType,
    components.postDirectional,
    components.secondaryUnit && components.secondaryNumber
      ? `${components.secondaryUnit} ${components.secondaryNumber}`
      : components.secondaryUnit,
  ].filter(Boolean).join(" ");
  if (street) lineParts.push(street);

  // Line 2: city state zip
  const cityStateZip = [
    components.city,
    components.state,
    components.zip4 ? `${components.zip}-${components.zip4}` : components.zip,
  ].filter(Boolean).join(" ");
  if (cityStateZip) lineParts.push(cityStateZip);

  const normalized = lineParts.join(", ");

  // Confidence heuristic
  const hasStreetNum = !!components.streetNumber;
  const hasStreetType = !!components.streetType;
  const hasCity = !!components.city;
  const hasState = !!components.state;
  const hasZip = !!components.zip;

  const score = [hasStreetNum, hasStreetType, hasCity, hasState, hasZip].filter(Boolean).length;
  const confidence: "high" | "medium" | "low" = score >= 4 ? "high" : score >= 2 ? "medium" : "low";

  return { components, normalized, confidence };
}

// ----- Handler -----
async function handler(input: Input) {
  const { components, normalized, confidence } = parseAddress(input.address);

  return {
    original: input.address,
    normalized,
    confidence,
    ...(input.includeComponents && { components }),
  };
}

// ----- Register -----
const addressNormalizerTool: ToolDefinition<Input> = {
  name: "address-normalizer",
  description:
    "Normalize and standardize US mailing addresses to USPS format. Expands abbreviations, corrects capitalization, standardizes street types and directionals, and parses address components (street number, street name, unit, city, state, ZIP).",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["address", "normalization", "usps", "postal", "parsing"],
    pricing: "$0.0005 per call",
    exampleInput: {
      address: "123 main st apt 4b, springfield, il 62701",
      includeComponents: true,
    },
  },
};

registerTool(addressNormalizerTool);

export default addressNormalizerTool;
