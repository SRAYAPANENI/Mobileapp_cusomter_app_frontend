export interface OfferResponse {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  code: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_PLATFORM_FEE';
  discount_value: number;
  target_audience: string;
  min_order_value: number;
  max_discount_amount: number | null;
  max_redemptions: number;
  redemptions_count: number;
  is_active: boolean;
  starts_at: string;
  expires_at: string | null;
  claimed_by_me: boolean;
}
