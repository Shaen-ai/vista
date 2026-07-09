/** Matches Laravel `live-search` snake_case payloads used by Vista `LiveSearchProduct`. */
export type AmRetailLiveRow = {
  name: string;
  price: number;
  currency: string;
  old_price: number | null;
  product_url: string;
  image_url: string | null;
  source_marketplace: string;
  source_key: string;
  in_stock: boolean | null;
  brand: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  width_cm: string | null;
  depth_cm: string | null;
  height_cm: string | null;
};

export type AmRetailSourceRow = {
  key: string;
  name: string;
  logo: string | null;
  count: number;
  elapsed_ms: number;
  status: "ok" | "error";
  error?: string;
};
