// Kept in sync with the CHECK constraint on vehicles.city
// (043_vehicle_city.sql) — a fixed list, not an admin-managed catalog, since
// PH cities/municipalities don't need routine curation the way car models do.
export const CITY_OPTIONS = [
  { value: 'manila', label: 'Manila' },
  { value: 'quezon_city', label: 'Quezon City' },
  { value: 'caloocan', label: 'Caloocan' },
  { value: 'las_pinas', label: 'Las Piñas' },
  { value: 'makati', label: 'Makati' },
  { value: 'malabon', label: 'Malabon' },
  { value: 'mandaluyong', label: 'Mandaluyong' },
  { value: 'marikina', label: 'Marikina' },
  { value: 'muntinlupa', label: 'Muntinlupa' },
  { value: 'navotas', label: 'Navotas' },
  { value: 'paranaque', label: 'Parañaque' },
  { value: 'pasay', label: 'Pasay' },
  { value: 'pasig', label: 'Pasig' },
  { value: 'san_juan', label: 'San Juan' },
  { value: 'taguig', label: 'Taguig' },
  { value: 'valenzuela', label: 'Valenzuela' },
  { value: 'pateros', label: 'Pateros' },
  { value: 'antipolo', label: 'Antipolo' },
  { value: 'bacoor', label: 'Bacoor' },
  { value: 'imus', label: 'Imus' },
  { value: 'dasmarinas', label: 'Dasmariñas' },
  { value: 'san_pedro', label: 'San Pedro' },
  { value: 'santa_rosa', label: 'Santa Rosa' },
  { value: 'san_jose_del_monte', label: 'San Jose del Monte' },
  { value: 'other', label: 'Other' },
] as const;

export function cityLabel(value: string): string {
  return CITY_OPTIONS.find((c) => c.value === value)?.label ?? value;
}
