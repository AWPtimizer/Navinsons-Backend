import { Router } from 'express';
import axios from 'axios';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { env } from '../config/env.js';

const router = Router();

interface NominatimResult {
  display_name: string;
  address?: { postcode?: string };
}

interface GoogleAutocompleteResult {
  suggestions?: { placePrediction?: { placeId: string; text?: { text: string } } }[];
}

interface GoogleDetailsResult {
  addressComponents?: { longText: string; types: string[] }[];
}

// Session tokens bundle a user's typing session + the terminating Place
// Details call into one billable unit under Google's pricing — cheaper than
// billing every keystroke search individually. Generated client-side per
// autocomplete session, just forwarded here.
// https://developers.google.com/maps/documentation/places/web-service/session-pricing
const searchGoogle = async (query: string, sessionToken?: string) => {
  const { data } = await axios.post<GoogleAutocompleteResult>(
    'https://places.googleapis.com/v1/places:autocomplete',
    { input: query, includedRegionCodes: ['in'], sessionToken },
    { headers: { 'X-Goog-Api-Key': env.googlePlacesApiKey, 'Content-Type': 'application/json' } }
  );
  return (data.suggestions ?? [])
    .filter((s) => s.placePrediction)
    .map((s) => ({ label: s.placePrediction!.text?.text ?? '', placeId: s.placePrediction!.placeId }));
};

const searchNominatim = async (query: string) => {
  // Free fallback while Google Places isn't configured yet (no
  // GOOGLE_PLACES_API_KEY) — see .env.example.
  const { data } = await axios.get<NominatimResult[]>('https://nominatim.openstreetmap.org/search', {
    params: { q: query, format: 'jsonv2', addressdetails: 1, countrycodes: 'in', limit: 6 },
    headers: { 'User-Agent': 'NavinSonsAdmin/1.0 (info@navinsons.com)' },
  });
  return data.map((r) => ({ label: r.display_name, pincode: r.address?.postcode ?? '' }));
};

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.q as string | undefined)?.trim();
    const sessionToken = req.query.sessionToken as string | undefined;
    if (!query || query.length < 4) {
      res.json([]);
      return;
    }

    const results = env.googlePlacesApiKey
      ? await searchGoogle(query, sessionToken)
      : await searchNominatim(query);
    res.json(results);
  })
);

// Google's Autocomplete predictions don't include address components (so no
// pincode) — a picked suggestion needs this second lookup, which also
// terminates the billing session started in /search above. Not needed for
// the Nominatim path, which already returns the pincode in /search.
router.get(
  '/place/:placeId',
  asyncHandler(async (req, res) => {
    if (!env.googlePlacesApiKey) {
      res.json({ pincode: '' });
      return;
    }

    const sessionToken = req.query.sessionToken as string | undefined;
    const { data } = await axios.get<GoogleDetailsResult>(
      `https://places.googleapis.com/v1/places/${req.params.placeId}`,
      {
        params: sessionToken ? { sessionToken } : {},
        headers: { 'X-Goog-Api-Key': env.googlePlacesApiKey, 'X-Goog-FieldMask': 'addressComponents' },
      }
    );

    const postal = data.addressComponents?.find((c) => c.types.includes('postal_code'));
    res.json({ pincode: postal?.longText ?? '' });
  })
);

export default router;
