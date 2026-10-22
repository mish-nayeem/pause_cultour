// All the static page copy lives here so it can be edited without touching any
// component. Each entry renders through src/pages/Info.jsx.
//
// Anything in [SQUARE BRACKETS] is a placeholder you must replace with your
// real details before launch.

export const CONTACT_EMAIL = 'pause.bd@gmail.com'
export const CONTACT_PHONE = '+8801706188605'
export const INSTAGRAM = 'https://www.instagram.com/pause.cultour'
export const FACEBOOK = 'https://www.facebook.com/pause.bd'
// No TikTok account yet — the footer icon points here until there is one.
// Either fill this in or remove the TikTok icon from src/components/Footer.jsx.
export const TIKTOK = 'https://www.instagram.com/pause.cultour'

export const INFO_PAGES = {
  contact: {
    title: 'Contact info',
    eyebrow: 'SUPPORT',
    intro:
      "Questions about an order, a size, or a drop? Message us and we'll get back within one working day.",
    blocks: [
      {
        type: 'contact',
        items: [
          { label: 'EMAIL', value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
          { label: 'PHONE / WHATSAPP', value: CONTACT_PHONE, href: `tel:${CONTACT_PHONE}` },
          { label: 'INSTAGRAM', value: '@pause.cultour', href: INSTAGRAM },
        ],
      },
      {
        type: 'text',
        heading: 'About your order',
        body:
          'Have your order number ready — it starts with PC and is in the confirmation email we sent when you placed the order. With it we can check your delivery status straight away.',
      },
    ],
  },

  'size-guide': {
    title: 'Size guide',
    eyebrow: 'SUPPORT',
    intro:
      'All measurements are of the garment laid flat, in inches. Measure a piece you already own and compare — it is more reliable than body measurements.',
    blocks: [
      {
        type: 'table',
        heading: 'Tops — t-shirts, shirts, hoodies',
        head: ['SIZE', 'CHEST', 'LENGTH', 'SHOULDER'],
        rows: [
          ['S', '20', '27', '17.5'],
          ['M', '21', '28', '18.5'],
          ['L', '22', '29', '19.5'],
          ['XL', '23', '30', '20.5'],
        ],
      },
      {
        type: 'table',
        heading: 'Bottoms — pants, shorts',
        head: ['SIZE', 'WAIST', 'HIP', 'INSEAM'],
        rows: [
          ['S', '29', '39', '29'],
          ['M', '31', '41', '29.5'],
          ['L', '33', '43', '30'],
          ['XL', '35', '45', '30.5'],
        ],
      },
      {
        type: 'text',
        heading: 'How to measure',
        body:
          'Lay the garment flat and smooth out the fabric. Chest is measured one inch below the armhole, straight across. Length runs from the highest point of the shoulder to the hem. Waist is measured across the top of the waistband and doubled.',
      },
      {
        type: 'text',
        heading: 'Between two sizes?',
        body:
          'Our fits run boxy, so size down for a closer fit or stay on the larger size if you like room. Each product page carries its own measurements under SIZE CHART.',
      },
    ],
  },

  delivery: {
    title: 'Delivery info',
    eyebrow: 'SUPPORT',
    intro:
      'Everything is cash on delivery. You pay the rider when the parcel reaches you — nothing is charged before that.',
    blocks: [
      {
        type: 'table',
        heading: 'Timeline and charges',
        head: ['AREA', 'TIME', 'CHARGE'],
        rows: [
          ['Inside Dhaka', '1–2 working days', '[৳60]'],
          ['Outside Dhaka', '3–5 working days', '[৳120]'],
        ],
      },
      {
        type: 'text',
        heading: 'How it works',
        body:
          'Once you place an order you get a confirmation email with your order number. We email you again when the parcel leaves us, and a last time once it has been delivered. If you did not give an email address, we will call you instead.',
      },
      {
        type: 'text',
        heading: 'Before you accept the parcel',
        body:
          'Please check the parcel in front of the rider. If anything is wrong — wrong size, wrong item, or damage — refuse the delivery and call us the same day. It is much easier to fix at that point than after the rider has left.',
      },
      {
        type: 'text',
        heading: 'Failed deliveries',
        body:
          'Our courier attempts delivery twice. If both attempts fail because the number is unreachable or the address is wrong, the order is cancelled and returned to us.',
      },
    ],
  },

  privacy: {
    title: 'Privacy policy',
    eyebrow: 'SUPPORT',
    intro:
      'We collect the minimum needed to get a parcel to your door, and we do not sell it to anyone.',
    blocks: [
      {
        type: 'text',
        heading: 'What we collect',
        body:
          'When you place an order: your name, phone number, delivery address and area, an optional email address, and any delivery note you write. When you join our mailing list: your email address only.',
      },
      {
        type: 'text',
        heading: 'What we use it for',
        body:
          'Your details are used to pack and deliver your order, to contact you about that order, and — if you subscribed — to tell you when a new drop lands. Nothing else.',
      },
      {
        type: 'text',
        heading: 'Who else sees it',
        body:
          'The courier gets your name, phone number and address, because they cannot deliver without it. Our order data is stored with Supabase and our order emails are sent through Brevo. We do not sell or rent your information to anyone.',
      },
      {
        type: 'text',
        heading: 'Payment',
        body:
          'We are cash on delivery only. We never ask for card details, mobile banking PINs, or OTPs — if anyone claiming to be us asks for those, it is not us.',
      },
      {
        type: 'text',
        heading: 'Your choices',
        body: `Every newsletter has an unsubscribe link. To have your details removed from our records, email ${CONTACT_EMAIL} with your order number and we will delete them, except where we are required to keep a sales record.`,
      },
    ],
  },

  terms: {
    title: 'Terms of service',
    eyebrow: 'SUPPORT',
    intro: 'The short version of how ordering from us works.',
    blocks: [
      {
        type: 'text',
        heading: 'Orders',
        body:
          'Placing an order is a request, not a confirmed sale. We confirm it by email or phone. We may cancel an order if the item turns out to be out of stock, if the address is outside our delivery area, or if we cannot reach you.',
      },
      {
        type: 'text',
        heading: 'Stock',
        body:
          'We release in small drops. When a size sells out it is marked sold out on the product page, and we usually do not restock a finished drop.',
      },
      {
        type: 'text',
        heading: 'Prices',
        body:
          'All prices are in Bangladeshi Taka and include VAT where applicable. Delivery is charged separately and shown before you confirm. Prices can change, but never after you have placed an order.',
      },
      {
        type: 'text',
        heading: 'Product images',
        body:
          'We photograph every piece ourselves. Colours can still look slightly different between screens, so small variation between the photo and the garment is normal.',
      },
      {
        type: 'text',
        heading: 'Our designs',
        body:
          'The PAUSE name, our graphics and our photography belong to us. Please do not reproduce them commercially.',
      },
    ],
  },

  refunds: {
    title: 'Return & refund',
    eyebrow: 'SUPPORT',
    intro:
      'We want you in something that fits. If something is wrong, tell us within 3 days of delivery.',
    blocks: [
      {
        type: 'text',
        heading: 'When we refund',
        body:
          'Two cases only: the piece arrived faulty or damaged, or we sent the wrong size and the right size is out of stock (if it is in stock, we exchange it instead). Tell us within 3 days of delivery — we call you, collect the piece at our cost and refund the price of the piece. The first delivery charge is not refunded.',
      },
      {
        type: 'text',
        heading: 'What we cannot take back',
        body:
          'Items that have been worn, washed, altered or damaged after delivery, and anything without its tags. For hygiene reasons, headwear and accessories cannot be returned unless faulty.',
      },
      {
        type: 'text',
        heading: 'Changed your mind',
        body:
          'Because we are cash on delivery, the easiest time to change your mind is at the door — just refuse the parcel and nothing is charged. Once you have paid and accepted it, we can only exchange, not refund.',
      },
      {
        type: 'text',
        heading: 'How to start',
        body: `Open the Return & Exchange Portal on this page, enter your order number with the email or phone you ordered with, and send the request. You can also email ${CONTACT_EMAIL} or message us on Instagram. We reply within one working day.`,
      },
    ],
  },

  exchange: {
    title: 'Exchange policy',
    eyebrow: 'SUPPORT',
    intro: 'Wrong size? Swap it for another size of the same piece within 3 days of delivery.',
    blocks: [
      {
        type: 'text',
        heading: 'What can be exchanged',
        body:
          'Any piece for another size of the same product, subject to stock. The item must be unworn and unwashed, with tags on and in its original packaging.',
      },
      {
        type: 'text',
        heading: 'Delivery charges',
        body:
          'A size exchange goes out as a second parcel, and its delivery charge is paid by the customer to the rider: ৳80 inside Dhaka, ৳150 outside Dhaka. If we sent the wrong size, the wrong item or a faulty or damaged piece, we pay the delivery and the exchange is free.',
      },
      {
        type: 'text',
        heading: 'How it works',
        body:
          'Send an exchange request from the Return & Exchange Portal with the size you want. We confirm stock, the rider brings the new size and takes the old one back in the same trip.',
      },
    ],
  },
}

// The tab row on /support, left to right. `portal` isn't a page of copy —
// it's the refund / exchange request form (src/components/ReturnPortal.jsx).
export const SUPPORT_TABS = [
  { slug: 'refunds', label: 'Return & Refund' },
  { slug: 'exchange', label: 'Exchange Policy' },
  { slug: 'delivery', label: 'Delivery Info' },
  { slug: 'size-guide', label: 'Size Guide' },
  { slug: 'contact', label: 'Contact Info' },
  { slug: 'privacy', label: 'Privacy Policy' },
  { slug: 'terms', label: 'Terms of Service' },
  { slug: 'portal', label: 'Return & Exchange Portal' },
]
