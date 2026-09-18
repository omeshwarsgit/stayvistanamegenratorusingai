/**
 * llm.js — optional Claude pass over the verified fact sheet.
 *
 * The engine works entirely without this. When an API key is present, Claude
 * proposes additional names from the *same* fact sheet, and every name it
 * returns goes back through the accuracy gate, the character limit and the
 * scorer before it can be shown. Claude proposes; the engine still decides.
 */

const MODEL = process.env.OTA_NAMER_MODEL || 'claude-opus-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let clientPromise = null;

export function llmStatus() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return { enabled: hasKey, model: hasKey ? MODEL : null };
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then((mod) => new (mod.default || mod.Anthropic)())
      .catch((err) => {
        clientPromise = null;
        throw new Error(`@anthropic-ai/sdk is not installed (${err.message}). Run: npm install`);
      });
  }
  return clientPromise;
}

const PROPOSE_TOOL = {
  name: 'propose_names',
  description: 'Return the proposed OTA property titles.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      names: {
        type: 'array',
        description: 'Between 6 and 10 proposed titles, best first.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'The title, within the character limit.' },
            style: {
              type: 'string',
              enum: ['usp', 'experience', 'location', 'luxury', 'group', 'brand'],
              description: 'Which naming approach this title uses.',
            },
            rationale: { type: 'string', description: 'One short sentence on why this works.' },
          },
          required: ['name', 'style', 'rationale'],
        },
      },
    },
    required: ['names'],
  },
};

const SYSTEM = `You are an OTA content specialist who writes property titles for Airbnb, Booking.com, MakeMyTrip, Agoda and Goibibo.

You will be given a fact sheet extracted from one live listing, plus a ranked list of that property's USPs. Propose titles that would make the right guest click.

Absolute rules — a title that breaks any of these is useless:
1. Use ONLY the facts and USP labels given. Never add a feature, view, distance, pool type, room count, guest count, location or quality claim that is not in the fact sheet. If the sheet says "Pool", you may not write "Private Pool".
2. Use each USP's label wording exactly as given (or the short form given). Do not embellish it.
3. Stay within the character limit given. Count characters, including spaces and separators.
4. No phone numbers, URLs, prices, discounts, urgency, ALL CAPS words, emoji, exclamation marks or unsupported superlatives ("best", "finest", "world-class").
5. Do not repeat the same word twice in one title.
6. Write for a guest scanning search results: specific, attractive, concise, natural. Prefer the pattern "size + strongest USP + property type + location", but adapt it — do not force every element in.
7. Vary the approach across your proposals: USP-led, experience-led, location-led, group/family-led, and brand-led if an existing brand name is given. Only use "luxury" wording if the fact sheet says luxury evidence is present.

Use the propose_names tool for your answer, with 6 to 10 titles, strongest first.`;

export async function suggestNames({ facts, ranking, limit }) {
  const client = await getClient();
  const sheet = buildFactSheet(facts, ranking, limit);

  const request = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{
      role: 'user',
      content: `Fact sheet for one listing (JSON). Propose titles with the propose_names tool.\n\n${JSON.stringify(sheet, null, 2)}`,
    }],
  };

  let response;
  try {
    response = await client.beta.messages.create({
      ...request,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
  } catch (err) {
    // Older SDKs / platforms reject the fallback parameter; the pass is still
    // worth running without it.
    if (!isParamError(err)) throw err;
    response = await client.messages.create(request);
  }

  if (response.stop_reason === 'refusal') {
    return { names: [], model: response.model, refused: true };
  }

  const call = (response.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_names');
  const raw = call ? call.input : parseJsonFromText(response.content || []);
  const names = raw && Array.isArray(raw.names) ? raw.names : [];

  return {
    names: names
      .filter((n) => n && typeof n.name === 'string')
      .map((n) => ({
        name: n.name.replace(/\s+/g, ' ').trim(),
        style: n.style || 'usp',
        rationale: typeof n.rationale === 'string' ? n.rationale.trim() : null,
      })),
    model: response.model || MODEL,
    usage: response.usage
      ? { input: response.usage.input_tokens, output: response.usage.output_tokens }
      : null,
  };
}

/** Only the verified sheet crosses the wire — never the raw page. */
function buildFactSheet(facts, ranking, limit) {
  const val = (f) => (f ? f.value : null);
  return {
    character_limit: limit,
    ota: facts.ota,
    existing_listing_name: val(facts.name),
    existing_brand_name: val(facts.brand),
    property_type: val(facts.propertyType),
    location: val(facts.location),
    bedrooms: val(facts.bedrooms),
    bathrooms: val(facts.bathrooms),
    guest_capacity: val(facts.guests),
    beds: val(facts.beds),
    luxury_evidence_present: Boolean(facts.luxury && facts.luxury.value),
    guest_fit: facts.guestFit,
    usps_ranked: (ranking.titleUsps || []).map((u) => ({
      label: u.label,
      short_form: u.short !== u.label ? u.short : undefined,
      strength: u.strength,
      why: u.reasons && u.reasons[0],
    })),
    weak_amenities_do_not_put_in_title: (ranking.commodities || []).slice(0, 8).map((u) => u.label),
    missing_information: facts.coverage ? facts.coverage.missing : [],
  };
}

function parseJsonFromText(blocks) {
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isParamError(err) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && err.message) || '');
  return status === 400 && /fallback|beta|unexpected|unrecognized|not supported/i.test(message);
}
