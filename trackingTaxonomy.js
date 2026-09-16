/**
 * Deterministic vendor + event taxonomy.
 * Everything in here is plain pattern matching -- no model involved.
 */

const VENDORS = [
  {
    id: 'ga4',
    label: 'Google Analytics 4',
    family: 'analytics',
    standard: true,
    match: (u) => /(google-analytics\.com|analytics\.google\.com)\/(g|mp)\/collect/.test(u),
  },
  {
    id: 'ua',
    label: 'Universal Analytics (deprecated)',
    family: 'analytics',
    match: (u) => /google-analytics\.com\/(r\/)?collect/.test(u) && !/\/g\/collect/.test(u),
  },
  {
    id: 'gtm',
    label: 'Google Tag Manager',
    family: 'container',
    match: (u) => /googletagmanager\.com\/(gtm|gtag)\/js/.test(u),
  },
  {
    id: 'google_ads',
    label: 'Google Ads Conversion',
    family: 'ads',
    match: (u) => /(googleadservices\.com\/pagead\/conversion|google\.com\/pagead\/1p-user-list|googleads\.g\.doubleclick\.net)/.test(u),
  },
  {
    id: 'meta_pixel',
    label: 'Meta (Facebook) Pixel',
    family: 'ads',
    standard: true,
    match: (u) => /facebook\.com\/tr\b/.test(u) || /connect\.facebook\.net\/.+\/fbevents\.js/.test(u),
  },
  { id: 'tiktok', label: 'TikTok Pixel', family: 'ads', match: (u) => /analytics\.tiktok\.com/.test(u) },
  { id: 'pinterest', label: 'Pinterest Tag', family: 'ads', match: (u) => /ct\.pinterest\.com/.test(u) },
  { id: 'snap', label: 'Snap Pixel', family: 'ads', match: (u) => /tr\.snapchat\.com/.test(u) },
  { id: 'bing', label: 'Microsoft/Bing UET', family: 'ads', match: (u) => /bat\.bing\.com/.test(u) },
  { id: 'criteo', label: 'Criteo', family: 'ads', match: (u) => /criteo\.(com|net)/.test(u) },
  { id: 'klaviyo', label: 'Klaviyo', family: 'crm', match: (u) => /klaviyo\.com/.test(u) },
  { id: 'clarity', label: 'Microsoft Clarity', family: 'behaviour', match: (u) => /clarity\.ms/.test(u) },
  { id: 'hotjar', label: 'Hotjar', family: 'behaviour', match: (u) => /hotjar\.(com|io)/.test(u) },
  { id: 'shopify', label: 'Shopify Analytics', family: 'platform', match: (u) => /(monorail-edge\.shopifysvc\.com|\/wpm@|shopify\.com\/.*\/events)/.test(u) },
  { id: 'segment', label: 'Segment', family: 'analytics', match: (u) => /api\.segment\.(io|com)/.test(u) },
];

/** Vendors that must be present for a page to be considered ad-ready. */
const REQUIRED_VENDOR_IDS = ['ga4', 'meta_pixel'];

/** Meta's standard event vocabulary. Anything else is a custom event. */
const META_STANDARD_EVENTS = new Set([
  'PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist',
  'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead',
  'CompleteRegistration', 'Contact', 'CustomizeProduct', 'Donate',
  'FindLocation', 'Schedule', 'StartTrial', 'SubmitApplication', 'Subscribe',
]);

/** GA4 recommended ecommerce/engagement events. */
const GA4_STANDARD_EVENTS = new Set([
  'page_view', 'session_start', 'first_visit', 'user_engagement', 'scroll',
  'click', 'view_item', 'view_item_list', 'select_item', 'add_to_cart',
  'remove_from_cart', 'view_cart', 'begin_checkout', 'add_payment_info',
  'add_shipping_info', 'purchase', 'refund', 'search', 'sign_up', 'login',
  'generate_lead', 'view_promotion', 'select_promotion',
]);

/** Events that signal real commercial intent -- what ad platforms optimise on. */
const CONVERSION_EVENT_PATTERNS = [
  /add[_\s-]?to[_\s-]?cart/i, /addtocart/i,
  /begin[_\s-]?checkout/i, /initiatecheckout/i,
  /purchase/i, /^lead$/i, /generate[_\s-]?lead/i, /subscribe/i,
  /complete[_\s-]?registration/i, /add[_\s-]?payment[_\s-]?info/i,
];

/** Query/body keys that change on every hit and must be ignored when de-duping. */
const VOLATILE_PARAMS = new Set([
  '_p', '_s', 'seq', 'sid', 'sct', '_et', 'ts', 'z', 'rnd', 'random',
  'cache', 'cb', 'eid', 'event_id', 'eventID', 'rl', 'if', 'ler', 'tfd',
  'dl', 'dr', '_z', 'v', 'jsonp', 'callback', '_fbp_ts',
]);

function classifyVendor(url) {
  return VENDORS.find((v) => v.match(url)) || null;
}

function isConversionEvent(name) {
  return !!name && CONVERSION_EVENT_PATTERNS.some((re) => re.test(name));
}

function isStandardEvent(vendorId, name) {
  if (!name) return false;
  if (vendorId === 'meta_pixel') return META_STANDARD_EVENTS.has(name);
  if (vendorId === 'ga4' || vendorId === 'ua') return GA4_STANDARD_EVENTS.has(name);
  return true; // other vendors have no public standard vocabulary we can assert against
}

module.exports = {
  VENDORS,
  REQUIRED_VENDOR_IDS,
  META_STANDARD_EVENTS,
  GA4_STANDARD_EVENTS,
  VOLATILE_PARAMS,
  classifyVendor,
  isConversionEvent,
  isStandardEvent,
};
