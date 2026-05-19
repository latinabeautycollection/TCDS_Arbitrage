import { buildCanonicalProductKey } from './buildCanonicalProductKey';
import { emptyIdentity, type NormalizedProductIdentity } from './commonIdentity';
import { normalizeAlphaNumeric, normalizeToken, tokenize } from './normalizeText';

const ACCESSORY_TERMS = new Set([
  'battery', 'charger', 'cable', 'case', 'strap', 'cover', 'adapter', 'bag',
  'tripod', 'stand', 'earpads', 'controller', 'dock', 'stylus', 'lens', 'cap',
]);

const BUNDLE_TERMS = new Set(['bundle', 'lot', 'set', 'kit', 'combo', 'pack']);

const BRANDS = [
  'apple', 'samsung', 'google', 'sony', 'nintendo', 'microsoft', 'canon', 'nikon',
  'olympus', 'fujifilm', 'bose', 'beats', 'jbl', 'dewalt', 'milwaukee', 'makita',
  'tascam', 'shure', 'yamaha', 'tp-link', 'netgear', 'ubiquiti', 'lenovo', 'dell',
  'hp', 'asus', 'acer', 'dji',
  // expanded 2026-05-05
'xfinity', 'motorola', 'symbol', 'tech2',  
'skar', 'audio fonics', 'irobot', 'roomba', 'whelen', 'meta', 'panasonic', 'lg',
  'philips', 'vizio', 'tcl', 'hisense', 'roku', 'garmin', 'fitbit', 'gopro', 'ring',
  'nest', 'anker', 'logitech', 'razer', 'corsair', 'sandisk', 'kingston', 'crucial',
  'seagate', 'wd', 'western digital', 'dyson', 'shark', 'eufy', 'twin power',
  'xs power', 'caretalk', 'extech', 'fluke', 'ryobi', 'craftsman', 'ridgid',
  'husky', 'klein', 'stanley', 'ninja', 'vitamix', 'cuisinart', 'kitchenaid',
  'instant pot', 'keurig', 'breville', 'oculus', 'peloton',
];

function detectBrand(text: string, fallback?: string | null): string | null {
  const normalizedFallback = fallback ? normalizeToken(fallback) : null;
  if (normalizedFallback) return normalizedFallback;
  for (const brand of BRANDS) {
    if (text.includes(brand)) return normalizeToken(brand);
  }
  return null;
}

function detectStorage(tokens: string[]): string | null {
  const found = tokens.find((t) => /^\d+(gb|tb)$/i.test(t));
  return found ? normalizeToken(found) : null;
}

function detectColor(tokens: string[]): string | null {
  const colors = ['black', 'white', 'silver', 'blue', 'red', 'green', 'gold', 'pink', 'purple'];
  const found = tokens.find((t) => colors.includes(t));
  return found ? normalizeToken(found) : null;
}

function detectGeneration(tokens: string[]): string | null {
  const found = tokens.find((t) => /^(gen|generation)?\d+$/.test(t) || /^\d(nd|rd|th|st)$/.test(t));
  return found ? normalizeToken(found.replace('generation', 'gen')) : null;
}

function detectGenericModelToken(tokens: string[]): string | null {
  // Matches SKU-shaped tokens like RP-800, SM-S937U, DMMC01, KW49CM, ADF-243
  const skuLike = tokens.find((t) =>
    /^[a-z]{2,}[-_]?\d{2,}[a-z0-9-]*$/i.test(t) ||
    /^\d+[a-z]+\d*$/i.test(t),
  );
  return skuLike ? normalizeToken(skuLike) : null;
}

function commonFlags(tokens: string[]): { isAccessory: boolean; isBundle: boolean } {
  const isAccessory = tokens.some((t) => ACCESSORY_TERMS.has(t));
  const isBundle = tokens.some((t) => BUNDLE_TERMS.has(t));
  return { isAccessory, isBundle };
}

function finalize(identity: NormalizedProductIdentity): NormalizedProductIdentity {
  identity.canonicalProductKey = buildCanonicalProductKey(identity);
  return identity;
}

export function deriveCategoryIdentity(input: {
  categoryKey: string | null;
  title: string;
  normalizedTitle?: string | null;
  brand?: string | null;
  model?: string | null;
}): NormalizedProductIdentity {
  const identity = emptyIdentity(input.categoryKey);
  const source = normalizeAlphaNumeric(input.normalizedTitle || input.title || '');
  const tokens = tokenize(`${source} ${input.model ?? ''}`);
  const brand = detectBrand(source, input.brand ?? null);
  const flags = commonFlags(tokens);

  identity.rawTokens = tokens;
  identity.normalizedBrand = brand;
  identity.normalizedStorage = detectStorage(tokens);
  identity.normalizedColor = detectColor(tokens);
  identity.normalizedGeneration = detectGeneration(tokens);
  identity.isAccessory = flags.isAccessory;
  identity.isBundle = flags.isBundle;

  switch (input.categoryKey) {
    case 'mobile_phones': {
      identity.normalizedProductType = 'smartphone';
      if (source.includes('iphone')) identity.normalizedModelFamily = 'iphone';
      else if (source.includes('galaxy')) identity.normalizedModelFamily = 'galaxy';
      else if (source.includes('pixel')) identity.normalizedModelFamily = 'pixel';
      identity.normalizedVariant =
        source.includes('pro max') ? 'pro_max'
          : source.includes('pro') ? 'pro'
          : source.includes('ultra') ? 'ultra'
          : source.includes('plus') ? 'plus'
          : source.includes('max') ? 'max'
          : null;
      identity.normalizedModelToken =
        tokens.find((t) => /^s\d{1,2}$/i.test(t) || /^iphone_\d+/i.test(t) || /^pixel_\d+/i.test(t))
        ?? tokens.find((t) => /^\d{1,2}$/.test(t))
        ?? detectGenericModelToken(tokens);
      break;
    }

    case 'game_consoles': {
      identity.normalizedProductType = 'console';
      if (source.includes('switch')) identity.normalizedModelFamily = 'switch';
      else if (source.includes('playstation') || source.includes('ps5') || source.includes('ps4')) identity.normalizedModelFamily = source.includes('ps5') ? 'ps5' : 'playstation';
      else if (source.includes('xbox')) identity.normalizedModelFamily = 'xbox';
      identity.normalizedVariant =
        source.includes('oled') ? 'oled'
          : source.includes('digital') ? 'digital'
          : source.includes('disc') ? 'disc'
          : source.includes('slim') ? 'slim'
          : null;
      identity.normalizedStorage = identity.normalizedStorage ?? tokens.find((t) => /^\d+(gb|tb)$/i.test(t)) ?? null;
      break;
    }

    case 'video_games': {
      identity.normalizedProductType = 'game';
      identity.normalizedPlatform =
        source.includes('ps5') ? 'ps5'
          : source.includes('ps4') ? 'ps4'
          : source.includes('xbox') ? 'xbox'
          : source.includes('switch') ? 'switch'
          : source.includes('pc') ? 'pc'
          : null;
      identity.normalizedModelFamily = tokens.slice(0, 4).join('_') || null;
      identity.isAccessory = flags.isAccessory && !source.includes('edition');
      break;
    }

    case 'cameras': {
      identity.normalizedProductType =
        source.includes('lens') ? 'lens'
          : source.includes('camera') || source.includes('dslr') || source.includes('mirrorless') ? 'camera'
          : 'camera';
      identity.isAccessory = identity.normalizedProductType === 'lens' || flags.isAccessory;
      identity.normalizedModelFamily =
        tokens.find((t) => /^a\d{3,4}$/i.test(t) || /^d\d{3,4}$/i.test(t) || /^eos_r/i.test(t))
        ?? input.model ? normalizeToken(input.model!) : null;
      identity.normalizedModelToken = identity.normalizedModelFamily;
      break;
    }

    case 'headphones':
    case 'audio_equipment':
    case 'audio': {
      identity.normalizedProductType =
        source.includes('earbuds') ? 'earbuds'
          : source.includes('headphones') ? 'headphones'
          : source.includes('mixer') ? 'mixer'
          : source.includes('microphone') ? 'microphone'
          : source.includes('speaker') ? 'speaker'
          : 'audio';
      identity.normalizedVariant =
        source.includes('pro') ? 'pro'
          : source.includes('max') ? 'max'
          : source.includes('studio') ? 'studio'
          : source.includes('elite') ? 'elite'
          : source.includes('wireless') ? 'wireless'
          : null;
      identity.normalizedModelFamily =
        source.includes('airpods pro') ? 'airpods_pro'
          : source.includes('airpods') ? 'airpods'
          : tokens.find((t) => /^wh_?\d+/i.test(t) || /^xm\d+/i.test(t))
          ?? detectGenericModelToken(tokens);
      identity.normalizedModelToken = identity.normalizedModelFamily;
      break;
    }

    case 'networking': {
      identity.normalizedProductType =
        source.includes('router') ? 'router'
          : source.includes('switch') ? 'switch'
          : source.includes('access point') ? 'access_point'
          : source.includes('modem') ? 'modem'
          : 'networking';
      identity.normalizedModelToken = tokens.find((t) => /[a-z]+\d+[a-z0-9-]*/i.test(t)) ?? null;
      identity.normalizedModelFamily = identity.normalizedModelToken;
      break;
    }

    case 'computing': {
      identity.normalizedProductType =
        source.includes('macbook') || source.includes('laptop') || source.includes('thinkpad') ? 'laptop'
          : source.includes('ipad') || source.includes('tablet') || source.includes('surface') ? 'tablet'
          : source.includes('monitor') ? 'monitor'
          : source.includes('desktop') ? 'desktop'
          : 'computing';
      identity.normalizedModelFamily =
        source.includes('macbook') ? 'macbook'
          : source.includes('ipad') ? 'ipad'
          : source.includes('surface') ? 'surface'
          : source.includes('thinkpad') ? 'thinkpad'
          : detectGenericModelToken(tokens);
      break;
    }

    case 'tools':
    case 'tools_small': {
      identity.normalizedProductType =
        source.includes('drill') ? 'drill'
          : source.includes('impact') ? 'impact_driver'
          : source.includes('saw') ? 'saw'
          : source.includes('router') ? 'router'
          : 'tool';
      identity.isAccessory = flags.isAccessory || source.includes('bare tool') === false && (source.includes('battery') || source.includes('charger'));
      identity.normalizedVariant =
        source.includes('bare tool') ? 'bare_tool'
          : source.includes('kit') ? 'kit'
          : null;
           identity.normalizedModelToken = detectGenericModelToken(tokens);
      identity.normalizedModelFamily = identity.normalizedModelToken;
      break;
    }

    case 'drones': {
      identity.normalizedProductType = 'drone';
      identity.normalizedModelFamily =
        source.includes('mini') ? 'mini'
          : source.includes('mavic') ? 'mavic'
          : source.includes('air') ? 'air'
          : detectGenericModelToken(tokens);
      identity.normalizedVariant =
        source.includes('fly more') ? 'fly_more'
          : source.includes('combo') ? 'combo'
          : null;
      break;
    }

    case 'music_instruments': {
      identity.normalizedProductType =
        source.includes('guitar') ? 'guitar'
          : source.includes('keyboard') ? 'keyboard'
          : source.includes('mixer') ? 'mixer'
          : source.includes('interface') ? 'interface'
          : source.includes('mic') ? 'microphone'
          : 'music_instrument';
      identity.isAccessory = flags.isAccessory;
      identity.normalizedModelToken = tokens.find((t) => /[a-z]+\d+[a-z0-9-]*/i.test(t)) ?? null;
      identity.normalizedModelFamily = identity.normalizedModelToken;
      break;
    }

    default: {
      identity.normalizedProductType = null;
      identity.normalizedModelFamily = input.model ? normalizeToken(input.model) : null;
      identity.normalizedModelToken = identity.normalizedModelFamily;
      break;
    }
  }

  return finalize(identity);
}
