import { supabase } from './supabaseClient.js'

// Courier hand-off, from the admin panel's side.
//
// The actual API calls can't happen here: a courier key in the browser is a
// key anyone can read, and most of these APIs refuse cross-origin requests
// anyway. So this file only asks the `courier` edge function to do it, the
// same way the mail helpers ask their functions. The function holds the
// credentials and writes the consignment id back onto the order.
//
// The plumbing is in place before the integration is: until the function is
// deployed with real keys, every call comes back as "not connected yet" and
// the admin panel says so plainly rather than looking broken.

export const COURIERS = [
  { key: 'steadfast', label: 'Steadfast' },
  { key: 'pathao', label: 'Pathao' },
  { key: 'redx', label: 'RedX' },
]

export function courierLabel(key) {
  return COURIERS.find((c) => c.key === key)?.label || key || ''
}

// Turns whatever came back into something worth showing the admin. The two
// cases worth naming are "nobody has set this up yet" and "the courier said
// no" — everything else is a connection problem.
function readError(error, data) {
  const raw = error?.message || data?.error || ''

  if (!raw) return null

  if (raw.includes('NOT_DEPLOYED') || error?.message?.includes('Failed to send a request')) {
    return 'Courier isn’t connected yet — the courier function hasn’t been deployed.'
  }

  if (raw.includes('NOT_CONFIGURED')) {
    return 'That courier has no API keys set yet. Add them in Edge Functions → Secrets.'
  }

  if (raw.startsWith('COURIER_SAID:')) {
    return `The courier rejected it: ${raw.replace('COURIER_SAID:', '').trim()}`
  }

  return 'Couldn’t reach the courier. Try again in a moment.'
}

export async function sendToCourier(orderId, courier) {
  try {
    const { data, error } = await supabase.functions.invoke('courier', {
      body: { action: 'create', orderId, courier },
    })

    const message = readError(error, data)
    if (message) return { consignmentId: null, error: message }

    return { consignmentId: data?.consignmentId ?? null, error: null }
  } catch (err) {
    console.warn('[Courier] create unreachable:', err.message)
    return { consignmentId: null, error: readError({ message: 'NOT_DEPLOYED' }) }
  }
}

export async function syncCourierStatus(orderId) {
  try {
    const { data, error } = await supabase.functions.invoke('courier', {
      body: { action: 'status', orderId },
    })

    const message = readError(error, data)
    if (message) return { status: null, error: message }

    return { status: data?.status ?? null, error: null }
  } catch (err) {
    console.warn('[Courier] status unreachable:', err.message)
    return { status: null, error: readError({ message: 'NOT_DEPLOYED' }) }
  }
}
