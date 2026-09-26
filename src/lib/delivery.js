// Delivery zones, districts, and the advance-payment rule that hangs off them.
//
// Dhaka district is plain cash on delivery. Everywhere else is where COD hurts
// — a refused parcel out there costs us the return fare — so those orders take
// a fixed bKash advance before they are accepted, and the rider collects the
// rest at the door.
//
// Checkout, the confirmation page and the admin panel all read these numbers
// from here, so what the customer is told and what the rider collects can't
// drift apart. place_order (supabase-schema.sql) re-does the same sums
// server-side and refuses an order that doesn't match — change the fees,
// the advance or the Dhaka rule there too.

export const BKASH_NUMBER = '01881958831'

export const ZONES = [
  {
    key: 'inside',
    label: 'Inside Dhaka',
    fee: 80,
    advance: 0,
    title: 'INSIDE DHAKA — CASH ON DELIVERY',
    note: 'No advance payment needed',
  },
  {
    key: 'outside',
    label: 'Outside Dhaka',
    fee: 120,
    advance: 200,
    title: 'OUTSIDE DHAKA — ADVANCE PAY',
    note: 'bKash advance payment required',
  },
]

// All 64 districts, Dhaka first because it is both the commonest address and
// the only one that skips the advance — the rest follow alphabetically.
export const INSIDE_DISTRICT = 'Dhaka'

export const DISTRICTS = [
  'Dhaka',
  'Bagerhat',
  'Bandarban',
  'Barguna',
  'Barishal',
  'Bhola',
  'Bogura',
  'Brahmanbaria',
  'Chandpur',
  'Chapai Nawabganj',
  'Chattogram',
  'Chuadanga',
  'Cumilla',
  "Cox's Bazar",
  'Dinajpur',
  'Faridpur',
  'Feni',
  'Gaibandha',
  'Gazipur',
  'Gopalganj',
  'Habiganj',
  'Jamalpur',
  'Jashore',
  'Jhalokati',
  'Jhenaidah',
  'Joypurhat',
  'Khagrachhari',
  'Khulna',
  'Kishoreganj',
  'Kurigram',
  'Kushtia',
  'Lakshmipur',
  'Lalmonirhat',
  'Madaripur',
  'Magura',
  'Manikganj',
  'Meherpur',
  'Moulvibazar',
  'Munshiganj',
  'Mymensingh',
  'Naogaon',
  'Narail',
  'Narayanganj',
  'Narsingdi',
  'Natore',
  'Netrokona',
  'Nilphamari',
  'Noakhali',
  'Pabna',
  'Panchagarh',
  'Patuakhali',
  'Pirojpur',
  'Rajbari',
  'Rajshahi',
  'Rangamati',
  'Rangpur',
  'Satkhira',
  'Shariatpur',
  'Sherpur',
  'Sirajganj',
  'Sunamganj',
  'Sylhet',
  'Tangail',
  'Thakurgaon',
]

export function getZone(key) {
  return ZONES.find((z) => z.key === key) || null
}

// The district is what the customer picks; the zone is what it costs. Gazipur
// and Narayanganj are their own districts, so they pay the outside rate even
// though they sit next to the city.
export function zoneForDistrict(district) {
  if (!district) return ''
  return district === INSIDE_DISTRICT ? 'inside' : 'outside'
}

// The whole money picture for a cart going to a given district. `due` is what
// the rider collects — by then the advance, if there was one, is already paid.
export function quote(subtotal, district) {
  const zone = getZone(zoneForDistrict(district))

  if (!zone) {
    return { zone: null, fee: 0, advance: 0, total: subtotal, due: subtotal }
  }

  const total = subtotal + zone.fee
  // Never ask for more up front than the order is even worth.
  const advance = Math.min(zone.advance, total)

  return { zone, fee: zone.fee, advance, total, due: total - advance }
}

// People paste this straight out of the bKash SMS — just the id, the id
// with its label ("TrxID BHK3XYZ12A."), or the whole message. Whatever comes
// in, only the id itself is kept, upper-cased, so a paste works as well as
// typing it out.
export function cleanTrxId(value) {
  const text = String(value ?? '').toUpperCase()

  const labelled = text.match(/TRX\s*ID\s*[:.#-]?\s*([A-Z0-9]+)/)
  if (labelled) return labelled[1]

  const firstWord = text.trim().split(/\s+/)[0] || ''
  return firstWord.replace(/[^A-Z0-9]/g, '')
}

// bKash sends a 10-character transaction id, but the exact length has changed
// before, so the check stays loose enough to survive that and tight enough to
// reject someone typing their name into the box. place_order applies the
// same pattern server-side.
export function isTrxId(value) {
  return /^[A-Z0-9]{8,16}$/.test(cleanTrxId(value))
}
