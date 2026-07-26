// Hand-written to match supabase/sql/001_schema.sql.
// Regenerate with `supabase gen types typescript` once the project is provisioned
// and this file can be replaced with the generated one.

export type VerifiedStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type AccountStatus = 'active' | 'suspended' | 'banned';
export type BodyType = 'sedan' | 'suv' | 'hatchback' | 'van' | 'pickup' | 'coupe' | 'convertible' | 'wagon' | 'mpv';
export type FuelType = 'gasoline' | 'diesel' | 'electric' | 'hybrid';
export type Transmission = 'manual' | 'automatic';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ListingStatus = 'active' | 'paused_by_owner' | 'paused_over_quota';
export type BookingStatus =
  | 'pending_owner' | 'owner_rejected' | 'expired'
  | 'pending_payment' | 'downpayment_paid' | 'fully_paid'
  | 'active' | 'completed'
  | 'cancelled_by_renter' | 'cancelled_by_owner' | 'cancelled_no_show' | 'owner_no_show';
export type PaymentType = 'downpayment' | 'balance' | 'deposit' | 'payout' | 'refund' | 'subscription';
export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
export type DisputeStatus = 'open' | 'resolved';

export interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  avatar_url: string | null;
  role: 'user' | 'support' | 'admin' | 'super_admin';
  is_lister: boolean;
  verified_status: VerifiedStatus;
  account_status: AccountStatus;
  strike_count: number;
  account_flagged: boolean;
  payout_method: 'bank_transfer' | 'gcash' | null;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  gcash_number: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoleChangeRequest {
  id: string;
  target_profile_id: string;
  requested_role: 'admin' | 'super_admin';
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface OcrFindings {
  name_match: 'match' | 'possible_mismatch' | 'unreadable';
  duplicate_of: string | null;
  suspicious_metadata: boolean;
  plate_match?: boolean;
  expiry_match?: boolean | null;
}

export interface VerificationSubmission {
  id: string;
  profile_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  phone: string;
  address: string;
  birthday: string;
  driver_license_number: string;
  secondary_id_type: string;
  license_front_path: string;
  license_back_path: string;
  secondary_id_front_path: string;
  secondary_id_back_path: string;
  selfie_with_id_path: string;
  selfie_face_path: string;
  status: 'pending' | 'verified' | 'rejected';
  rejection_reason: string | null;
  ban_evasion_flag: boolean;
  license_ocr_findings: OcrFindings | null;
  liveness_flag: boolean;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface CarBrand {
  id: string;
  name: string;
  created_at: string;
}

export interface CarModel {
  id: string;
  brand_id: string;
  name: string;
  body_type: BodyType;
  seats: number;
  fuel_type: FuelType;
  created_at: string;
}

export interface Vehicle {
  id: string;
  owner_id: string;
  model_id: string;
  plate_number: string;
  model_year: number | null;
  transmission: Transmission;
  city: string;
  daily_price: number;
  pickup_location: string;
  additional_info: string | null;
  owner_contact_number: string;
  orcr_path: string | null;
  orcr_expiry_date: string | null;
  orcr_expiry_reminder_sent: boolean;
  orcr_ocr_findings: OcrFindings | null;
  rental_agreement_path: string | null;
  requires_deposit: boolean;
  deposit_amount: number | null;
  approval_status: ApprovalStatus;
  rejection_reason: string | null;
  listing_status: ListingStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleImage {
  id: string;
  vehicle_id: string;
  storage_path: string;
  sort_order: number;
  created_at: string;
}

export interface Booking {
  id: string;
  vehicle_id: string;
  renter_id: string;
  owner_id: string;
  start_date: string;
  end_date: string;
  pickup_time: string;
  total_days: number;
  base_price: number;
  commission: number;
  total_price: number;
  downpayment_amount: number;
  balance_amount: number;
  deposit_amount: number;
  downpayment_paid: boolean;
  downpayment_paid_at: string | null;
  balance_paid: boolean;
  balance_paid_at: string | null;
  deposit_paid: boolean;
  deposit_paid_at: string | null;
  deposit_refunded: boolean;
  status: BookingStatus;
  cancellation_reason: string | null;
  owner_response_deadline: string | null;
  payment_deadline: string | null;
  renter_completed: boolean;
  owner_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleBlockedDate {
  id: string;
  vehicle_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  booking_id: string | null;
  subscription_id: string | null;
  payer_id: string;
  payment_type: PaymentType;
  amount: number;
  paymongo_reference: string | null;
  status: PaymentStatus;
  created_at: string;
}

export interface Subscription {
  id: string;
  profile_id: string;
  slots_granted: number;
  status: 'active' | 'expired' | 'cancelled';
  started_at: string;
  expires_at: string;
  paymongo_reference: string | null;
  created_at: string;
}

export interface PlatformSetting {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface CompanyInfo {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface Message {
  id: string;
  booking_id: string;
  sender_id: string;
  message: string;
  created_at: string;
}

export interface Review {
  id: string;
  booking_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
}

export interface Dispute {
  id: string;
  booking_id: string;
  reporter_id: string;
  description: string;
  photo_paths: string[];
  status: DisputeStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ListingReport {
  id: string;
  vehicle_id: string;
  reporter_id: string;
  reason: string;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// Convenience joined shape used by Browse/Car Detail — vehicle + model + brand + owner + cover image.
export interface VehicleListing extends Vehicle {
  model: CarModel & { brand: CarBrand };
  owner: Pick<Profile, 'id' | 'first_name' | 'last_name' | 'avatar_url'>;
  cover_image_url: string | null;
}
