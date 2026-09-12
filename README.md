# PAUSE — Website (Vite + React + Supabase)

## VS Code এ চালানোর নিয়ম

1. এই ফোল্ডারটা VS Code এ ওপেন করো
2. টার্মিনাল খুলে (Terminal → New Terminal) এই কমান্ড চালাও:
   ```
   npm install
   ```
3. **Supabase সেটআপ করো (অর্ডার সেভ হওয়ার জন্য জরুরি):**
   - `.env.example` ফাইলটা কপি করে নাম দাও `.env`
   - তোমার Supabase ড্যাশবোর্ড → Project Settings → API থেকে URL আর anon key কপি করে `.env` এ বসাও
   - Supabase ড্যাশবোর্ড → SQL Editor এ গিয়ে `supabase-schema.sql` ফাইলের পুরো কোড পেস্ট করে Run করো — এটা `orders` আর `order_items` টেবিল বানাবে
4. এরপর:
   ```
   npm run dev
   ```
5. টার্মিনালে একটা লোকাল লিংক দেখাবে (সাধারণত `http://localhost:5173`) — সেটা ব্রাউজারে খুলো

## ফোল্ডার স্ট্রাকচার

```
pause-website/
├── supabase-schema.sql     → Supabase এ একবার রান করার SQL
├── .env.example            → এটা কপি করে .env বানাও
├── src/
│   ├── pages/
│   │   ├── Home.jsx           → হোমপেজ
│   │   ├── Product.jsx        → প্রোডাক্ট ডিটেইল পেজ
│   │   ├── Cart.jsx           → কার্ট পেজ
│   │   ├── Checkout.jsx       → COD চেকআউট ফর্ম (Supabase এ অর্ডার সেভ করে)
│   │   └── OrderConfirmed.jsx → অর্ডার কনফার্মেশন/রিসিট
│   ├── components/
│   │   └── Nav.jsx         → শেয়ারড নেভিগেশন (লাইভ কার্ট কাউন্টসহ)
│   ├── context/
│   │   └── CartContext.jsx → কার্ট স্টেট (localStorage এ পার্সিস্ট করে)
│   ├── lib/
│   │   └── supabaseClient.js → Supabase কানেকশন সেটআপ
│   ├── data/
│   │   └── products.js     → ডামি প্রোডাক্ট ডাটা (এখানে এডিট করো)
│   ├── styles/
│   │   └── global.css      → কালার/ফন্ট ভ্যারিয়েবল
│   └── main.jsx            → রাউটিং সেটআপ
```

## যা কাজ করছে এখন

- প্রোডাক্ট ব্রাউজ করা, সাইজ সিলেক্ট করে কার্টে যোগ করা
- কার্ট পেজে কোয়ান্টিটি বদলানো, আইটেম রিমুভ করা
- COD চেকআউট ফর্ম (নাম, ফোন নাম্বার ভ্যালিডেশনসহ, ঠিকানা)
- অর্ডার সাবমিট করলে Supabase এর `orders` + `order_items` টেবিলে সেভ হয়
- অর্ডার কনফার্মেশন পেজে রিসিট দেখানো

## যা এখনো বাকি

- `src/data/products.js` এ ডামি ডাটার বদলে Supabase থেকে প্রোডাক্ট ফেচ করা (এখন প্রোডাক্ট লিস্ট স্ট্যাটিক, শুধু অর্ডারই ডাটাবেজে যাচ্ছে)
- প্রোডাক্ট ছবি এখন placeholder (picsum.photos থেকে) — আসল প্রোডাক্ট ফটো দিয়ে বদলাবে, Cloudinary তে আপলোড করে লিংক বসাবে
- অ্যাডমিন সাইড থেকে অর্ডার দেখার কোনো UI নেই — আপাতত Supabase ড্যাশবোর্ডের Table Editor থেকেই অর্ডার চেক করতে হবে
- ডোমেইন/হোস্টিং এখনো লাইভ করা হয়নি
