// Click-to-chat links: no WhatsApp API, no cost, nothing sent automatically.
// Each link opens WhatsApp with a message already written; the person just
// presses send. It's the same in both directions — a customer opening a chat
// with the shop after ordering, and the admin opening a chat with a customer.

// Bangladeshi numbers get typed as 017…, +880 17…, 8801… — wa.me wants digits
// only, with the country code and no leading zero.
export function toWhatsAppNumber(phone) {
  let digits = String(phone || '').replace(/\D/g, '')

  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('880')) return digits
  if (digits.startsWith('0')) return '880' + digits.slice(1)
  if (digits.length === 10 && digits.startsWith('1')) return '880' + digits

  return digits
}

export function whatsappLink(phone, text) {
  return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(text)}`
}

function taka(n) {
  return '৳' + Number(n).toLocaleString('en-US')
}

// Customer → shop, from the order-confirmed page. `order` is the object the
// checkout hands over (items, customer, delivery).
export function customerToShopMessage(order) {
  const items = order.items.map((i) => `${i.name} (${i.size}) x${i.qty}`).join(', ')
  const due = order.delivery?.due ?? order.subtotal

  return [
    `Hi PAUSE! I just placed order ${order.orderId} and want to confirm it.`,
    `Items: ${items}`,
    `To pay on delivery: ${taka(due)}`,
    `Name: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
  ].join('\n')
}

// Shop → customer, from the admin panel. `o` is an orders row with its
// order_items.
export function shopToCustomerMessage(o) {
  const items = (o.order_items || [])
    .map((i) => `${i.product_name} (${i.size}) x${i.qty}`)
    .join(', ')
  const total = Number(o.total ?? o.subtotal)
  const due = total - (Number(o.advance_amount) || 0)
  const first = String(o.customer_name || '').trim().split(/\s+/)[0]

  return [
    `Hi ${first}, this is PAUSE.`,
    `We got your order ${o.id}: ${items}.`,
    `To pay on delivery: ${taka(due)}.`,
    `Delivering to ${o.customer_address}${o.customer_area ? `, ${o.customer_area}` : ''}.`,
    'Please reply YES to confirm and we will send it out. Thank you!',
  ].join('\n')
}
