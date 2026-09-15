export type BlogCategory =
  | 'Cycle & Hormones'
  | 'Comfort & Care'
  | 'Skin & Body'
  | 'Sustainability'
  | 'Product Guides'
  | 'Community'

export interface BlogPost {
  slug: string
  title: string
  category: BlogCategory
  excerpt: string
  author: string
  date: string
  readTime: number
  /** CSS gradient used for the poster when there is no photo. */
  tone: string
  /** Optional real photo (from /assets/img/blogs). */
  image?: string
  featured?: boolean
  /** Body lines: '## ' → heading, '> ' → pull-quote, else paragraph. */
  body: string[]
}

interface CategoryMeta {
  color: string
  tint: string
}

export const CATEGORY_META: Record<BlogCategory, CategoryMeta> = {
  'Cycle & Hormones': { color: '#7B4FA6', tint: 'linear-gradient(150deg,#F2ECF9,#D6C2EC)' },
  'Comfort & Care': { color: '#9C4E82', tint: 'linear-gradient(150deg,#F7E7F1,#E6BFD8)' },
  'Skin & Body': { color: '#B07C2A', tint: 'linear-gradient(150deg,#FBF1D4,#F3DA95)' },
  Sustainability: { color: '#5E67B0', tint: 'linear-gradient(150deg,#E9ECFB,#C4CBEE)' },
  'Product Guides': { color: '#C98A00', tint: 'linear-gradient(150deg,#FCF3DC,#F6DC98)' },
  Community: { color: '#6A54A0', tint: 'linear-gradient(150deg,#EDE7FB,#CBBCEC)' },
}

export const CATEGORIES: BlogCategory[] = [
  'Cycle & Hormones',
  'Comfort & Care',
  'Skin & Body',
  'Sustainability',
  'Product Guides',
  'Community',
]

export const POSTS: BlogPost[] = [
  {
    slug: 'first-period-experience-india',
    title: 'My First Period Experience in India (2026): A Real Story Every Girl Should Read',
    category: 'Comfort & Care',
    excerpt:
      'A real first period story from 10th grade in India - first period symptoms, survival tips, dealing with school uniforms, telling mom, and essential menstrual hygiene.',
    author: 'Keerthi',
    date: 'August 1, 2026',
    readTime: 6,
    tone: CATEGORY_META['Comfort & Care'].tint,
    image: '/assets/img/blogs/first-period-india.png',
    featured: true,
    body: [
      'My first period experience is something I’ll never forget. Not because it was magical or exciting, but because it caught me completely off guard. Like many girls in India, I knew periods existed, but I had no idea about the first period symptoms, what I should do, or how I was supposed to feel when the day finally arrived. Looking back now, I realize that a little guidance could have saved me hours of panic and confusion.',
      '## The Day Everything Changed',
      'The day I got my first period is one of the most unforgettable days of my teenage life. Not because it was magical or beautiful, but mostly because it felt like my body launched a surprise attack without sending me an invitation.',
      'Hi, I’m Keerthi. Today, I work as a content writer, turning experiences into stories. But no matter how many stories I write, there’s one story I’ll never forget - my first period experience. I was in 10th grade when it happened.',
      'At that time, my knowledge about periods was incredibly simple: Girls bleed. That’s all I knew. No one had explained first period symptoms, how to use a sanitary pad, or what I should do if it happened at school.',
      'So, when my first period arrived during class, I completely panicked. My mind immediately started asking questions: "Did I get hurt?", "Am I sick?", "Should I tell someone?" Instead of asking for help, I came up with what I believed was a brilliant plan: get through the school day, go home, and pretend nothing happened.',
      '## Mission: Don’t Stain the Uniform',
      'For the rest of the day, I kept running to the restroom. Every time I stood up, I worried. Every time I sat down, I worried. Every time someone looked at me, I was convinced they knew my secret.',
      'A few friends noticed something was wrong, but I was too embarrassed to explain. By lunchtime, every chair looked dangerous and every white surface looked suspicious. I was on a mission: Don’t stain the school uniform.',
      'When the final bell rang, I felt proud. I thought I had survived the day without any embarrassing moments. Then I reached home and changed my clothes. Let’s just say... my pants had quietly sacrificed themselves for the mission.',
      '## Finally Telling My Mom',
      'When I got home, my mother was there. Did I tell her immediately? Of course not. Instead, I changed my clothes, had snacks, and acted as though everything was normal. Then she reminded me that it was time for tuition. I knew I couldn’t hide it anymore.',
      'I quietly called her into the washroom and showed her what had happened. She smiled gently and said, "You’ve got your first period." Just like that, my fear slowly disappeared.',
      'Later that evening, she showed me how to wear a sanitary pad and explained that periods are a normal part of growing up. The funniest part? Right in the middle of everything, she handed me my notebooks and said, "Finish your homework." Apparently, periods were important, but homework was still non-negotiable.',
      '> Your first period isn’t something to fear. It’s simply the beginning of understanding your body a little better.',
      '## What I Wish I Knew & Simple Tips',
      'If I could go back and meet my younger self, I’d tell her a few simple things: your first period is completely normal, feeling scared is okay, asking for help is never embarrassing, and leaks happen to almost every girl. Carrying an extra sanitary pad is always a good idea.',
      'Along with choosing the right sanitary pad, maintaining good menstrual hygiene is equally important. Simple habits like changing your pad every 4-6 hours, washing your hands before and after changing it, and choosing comfortable organic products make a world of difference. Whether you’re buying your first sanitary pad online or looking for better period care, Femi9 is here to help you stay comfortable and confident every day.',
    ],
  },
  {
    slug: 'first-period-guide-menstrual-hygiene-tips',
    title: 'What Nobody Told Me After My First Period: A Real Story Every Girl Should Read',
    category: 'Comfort & Care',
    excerpt:
      'What happens after your first period? Puberty functions, saree expectations, accidental leaks at school, crowded bus kindness, and questioning inherited period myths.',
    author: 'Keerthi',
    date: 'July 28, 2026',
    readTime: 7,
    tone: CATEGORY_META['Comfort & Care'].tint,
    image: '/assets/img/blogs/prevent-rashes.png',
    featured: true,
    body: [
      'My first period didn’t feel like the beginning of anything. It felt like an ending - something that happened, and then was simply over. I had no idea it was actually the start of something much bigger: a slow, sometimes confusing, sometimes lonely journey of growing up in a body that everyone suddenly had opinions about.',
      '## The Puberty Function and the Saree I Didn’t Choose',
      'A few months later, my puberty function was conducted. To be honest... I wasn’t excited. Everyone else seemed happier than I was. There were sweets, snacks, relatives, photos, new clothes, and of course... the saree.',
      'The only thing I remember clearly is wearing a saree for the first time. Everyone said I looked beautiful, but I felt uncomfortable. It didn’t feel like me. After the function, my mom scolded me for not wearing another saree she had chosen. I cried that day - not because of the saree, but because everything around me was changing so fast.',
      'That’s when I realized every girl grows up differently. Some of my friends weren’t allowed to sit on the sofa for a week or touch kitchen items. Hearing those stories made me feel relieved, but I also realized: after your first period, people slowly start treating you differently. Your clothes change. Expectations change.',
      '## When It Happened Again - In Front of Everyone',
      'A couple of years later, in higher secondary school, I got my period unexpectedly during class. I didn’t even realize I had leaked onto our light green uniform. Out of 30 students, there were only five girls in my class; the rest were boys.',
      'When I walked up to collect my answer paper, the teacher looked at me differently and called me outside. Nobody teaches you how heavy that moment feels - the embarrassment, the fear, the silence.',
      '## A Stranger’s Silent Kindness on a Crowded Bus',
      'Another memory stayed with me. Standing in a crowded bus, I unexpectedly leaked again. Two college girls beside me noticed, but no one told me. That day taught me a vital lesson: a simple act of kindness - quietly telling another girl about a stain - can save her from so much discomfort.',
      '## The Temple I Wasn’t Supposed to Visit',
      'On my birthday, while on my second day of period, I visited a Murugan temple with a friend. When my mother found out, she became upset: "You shouldn’t go to a temple during your periods." My father agreed. They were simply repeating what they were taught - beliefs passed down with love, but without questioning whether they were medically true.',
      '> Your period has never made you less worthy. It only made you human. And that’s something you should never be ashamed of.',
      '## Essential Menstrual Hygiene Rules',
      'Good periods hygiene isn’t complicated - it comes down to menstrual hygiene basics done consistently: changing pads on time, staying clean, and choosing breathable, chemical-free period products designed for your flow.',
    ],
  },
  {
    slug: 'menstrual-hygiene-tips-period-care-real-story',
    title: 'Years Later, Still "Ayyo": A Real Story About Periods, PMS, and the Beliefs We Inherit',
    category: 'Cycle & Hormones',
    excerpt:
      'Cramps, pimples, skipping water to avoid restrooms, and Paati’s 3-day rule. Examining the period myths and habits we inherit.',
    author: 'Keerthi',
    date: 'July 20, 2026',
    readTime: 6,
    tone: CATEGORY_META['Cycle & Hormones'].tint,
    image: '/assets/img/blogs/period-myths.png',
    featured: true,
    body: [
      'Years have passed since my first period. But one thing hasn’t changed - every month, when it’s about to arrive, my first reaction is still: "Ayyo... already ah?" 😭',
      '## The Combo Offer',
      'Forget just the bleeding. It’s the entire combo offer: cramps, pimples, mood swings, bloating. My face decides it’s time for a breakout exactly when I have an important meeting or function. Perfect timing! 😂',
      '## The Water I Wouldn’t Drink',
      'During my periods, especially on office days, I used to hardly drink water. Not because I didn’t like water, but because I didn’t want to keep running to the restroom. So my brain proudly said, "Simple... don’t drink water."',
      'Only later did I realize how important hydration actually is during periods. Skipping water to avoid trips to the washroom actually worsens cramps, headaches, and bloating! If someone had simply told me, "Keerthi, drink more water, it helps," I would have listened.',
      '## Paati’s Rule: Three Days, No Washing',
      'One month, I didn’t tell my grandma I got my period. When she saw a stain, she called me very seriously: "For the next three days, ask your amma to wash your clothes... old people shouldn’t wash these, it’s paavam."',
      'I didn’t argue. But years later, I started thinking differently: what if someone had taught my grandma about periods when she was young? What if she had received the medical awareness we have today?',
      '> Some traditions deserve to be continued. Some deserve to be questioned. And that’s how change begins - one conversation at a time.',
      '## Good Period Care Habits',
      'Hydration matters just as much during your period as any other day. Good menstrual hygiene tips apply just as much when grown: drink plenty of fluids, rest when needed, and choose rash-free sanitary pads designed for sensitive skin.',
    ],
  },
  {
    slug: 'period-fatigue-menstrual-hygiene-period-care-real-story',
    title: 'Human With 5% Battery: A Real Story About Period Fatigue, Family Rules & Growing Up',
    category: 'Cycle & Hormones',
    excerpt:
      'When period pain manifests as sheer exhaustion rather than cramps. Navigating family period rules, buying pads without shame, and wearing white pants with confidence.',
    author: 'Keerthi',
    date: 'July 14, 2026',
    readTime: 6,
    tone: CATEGORY_META['Cycle & Hormones'].tint,
    image: '/assets/img/blogs/period-fatigue.png',
    featured: true,
    body: [
      'Nobody tells you that good period care isn’t always about cramps. Mine doesn’t show up as classic PMS or unbearable pain - it shows up as sheer exhaustion, the kind of period fatigue nobody really warns you about.',
      '## Human With 5% Battery 🔋',
      'I don’t really get unbearable cramps. Instead... I become a human with 5% battery. No energy. No motivation. Just me... existing.',
      '## The Three Days I Became the Favourite Child',
      'Thankfully, my mom never let those days feel difficult. The moment she knew I was on my period: "Nee edhuvum pannadha, na paathukaren." Those three days, I felt like the favourite child! 😂',
      'But the minute my period was over, reality hit: "Poi thalai kulichitu va." First, wash your hair. No matter how much I asked why, Amma had only one answer: "Apdi dhaan." Some arguments are simply unwinnable.',
      '## Buying Pads Without Shame',
      'From the day I got my period until I started working, I never once told my dad, "Appa... pads vaangitu va." I’d call my mom, she’d tell my dad, and pads would magically appear. Looking back, why did something so normal - basic feminine hygiene - feel like something to hide?',
      '## "Stain Aana Enna... Wash Pannikalam"',
      'A few months ago, I wanted to wear white pants during my period. The old me panicked: "What if I stain it?" My mom smiled and said, "Stain aana enna... wash pannikalam." Such a simple sentence, but it made me feel so much lighter. The fear was never really about the stain - it was about being judged.',
      '> A stain is just a stain. It washes out. The more we understand our own body, the easier these five days become.',
      '## Self-Care & Reliable Protection',
      'Knowing how often to change a sanitary pad (every 4-6 hours) and using leak-proof, breathable organic cotton pads takes the "did I leak?" anxiety off your mind completely.',
    ],
  },
  {
    slug: 'period-myths-menstrual-hygiene-real-story',
    title: 'It’s a Period, Not a Password: A Real Story About Myths, Silence & Speaking Up',
    category: 'Community',
    excerpt:
      'Why are we still whispering for pads at medical shops? From honey permissions to lighting lamps, it’s time to treat periods as normal biological functions.',
    author: 'Keerthi',
    date: 'July 8, 2026',
    readTime: 5,
    tone: CATEGORY_META.Community.tint,
    image: '/assets/img/blogs/period-myths.png',
    featured: true,
    body: [
      'Sometimes I genuinely wonder... how many more years will it take for people to stop treating periods like a secret? 😭 Because even today, educated people around me still believe in period myths.',
      '## "Honey-ku Kooda Period Permission Venuma?"',
      'One day at my aunt’s house - she’s a very educated woman - I was about to take some honey and asked, "Aunty... honey venum." She immediately said, "No... nee periods la irukka la?"',
      'I literally froze. Honey-ku kooda period permission venuma? 😭😂 I asked, "Neenga innum idhellam believe panreengala?" She just smiled and said, "Ellarum ipdi dhaan irukaanga... adhu dhaane correct?" I went silent because arguing with someone’s lifelong belief isn’t a 2-minute conversation.',
      '## Same Team, Different Day',
      'At my office, our receptionist asked me: "Keerthi... innaiku mattum neenga deepam podreengala?" When I asked why, she said, "I’m on my fourth day of my period..." And I was on my second day! 😂',
      'I gently explained why periods shouldn’t decide whether we can light a lamp. After a brief chat, she said, "Okay... tomorrow la irundhu naan ipdi panna maaten." One small conversation made someone question something she’d always blindly accepted.',
      '## "Guys... It’s a Period. Not a Password!"',
      'Periods are still treated like a secret VIP topic. At medical shops, we confidently ask for medicines for anything, but when it comes to pads, the voice drops to a whisper: "Anna... adhu... one packet..." 🥲',
      '> Guys... it’s a PERIOD. Not a password! It’s normal!',
      '## Breaking Period Stigma',
      'Saying "period" without lowering your voice, buying pads without embarrassment, and choosing quality menstrual products are the small, daily steps that dismantle stigma.',
    ],
  },
  {
    slug: 'menstrual-cup-vs-sanitary-pad-vs-period-underwear',
    title: 'Menstrual Cup vs Sanitary Pad vs Period Underwear in India (2026): Which Is Right for You?',
    category: 'Product Guides',
    excerpt:
      'A comprehensive comparison of menstrual cups, sanitary pads, and period underwear. Pros, cons, hygiene, comfort, and choosing the best product for your lifestyle.',
    author: 'Dr. Gomathi',
    date: 'July 2, 2026',
    readTime: 8,
    tone: CATEGORY_META['Product Guides'].tint,
    image: '/assets/img/blogs/menstrual-cup-vs-pad.png',
    featured: true,
    body: [
      'Choosing the right menstrual product is a personal decision. With more options available today than ever before, many women wonder whether a menstrual cup, sanitary pad, or period underwear is the best choice. Each product offers unique benefits depending on your comfort, lifestyle, menstrual flow, and daily routine.',
      '## 1. Menstrual Cup',
      'A menstrual cup is a reusable medical-grade silicone cup inserted into the vagina to collect blood. It can provide protection for up to 12 hours and is cost-effective in the long run. However, it requires correct insertion/removal, sterilization between cycles, and has a learning curve.',
      '## 2. Period Underwear',
      'Period underwear contains absorbent layers built into washable fabric. It is soft, reusable, and great for light-to-moderate flow or backup protection, though it requires immediate washing and takes drying time.',
      '## 3. Sanitary Pads',
      'Sanitary pads remain the most trusted, beginner-friendly, and convenient option globally. They absorb flow externally with zero learning curve. Available for light, medium, heavy, and overnight flow, organic cotton pads like Femi9 ensure complete leak protection without skin irritation or chemical exposure.',
      '## Quick Comparison',
      '• Easy to use: Sanitary Pads (Excellent) | Period Underwear (Easy) | Menstrual Cup (Moderate)\n• Beginner Friendly: Sanitary Pads (Yes) | Period Underwear (Yes) | Menstrual Cup (No)\n• Maintenance: Sanitary Pads (Low/Disposable) | Period Underwear (Moderate) | Menstrual Cup (High/Sterilize)',
      '> Choose the product that matches your lifestyle, comfort level, flow, and budget. Many women combine options - using organic pads on heavy days and liners on lighter days.',
      '## Menstrual Hygiene Best Practices',
      'Change pads every 4-6 hours, wash hands before and after changing, and store period care products in a clean, dry place.',
    ],
  },
  {
    slug: 'pcos-pcod-silent-struggle-women-symptoms-guide',
    title: 'PCOS/PCOD: The Silent Struggle Many Women Face Every Day',
    category: 'Cycle & Hormones',
    excerpt:
      'PCOS and PCOD affect up to 1 in 5 Indian women. Understand the real difference between PCOS and PCOD, symptoms, diagnosis, and evidence-backed management.',
    author: 'Dr. Gomathi',
    date: 'June 25, 2026',
    readTime: 9,
    tone: CATEGORY_META['Cycle & Hormones'].tint,
    image: '/assets/img/blogs/pcos-pcod.png',
    featured: true,
    body: [
      'For years, she was told it was "just stress." Irregular periods, jawline acne past teenage years, and weight that wouldn’t budge. A pelvic ultrasound finally revealed polycystic ovaries. She was 24, and had been living with undiagnosed PCOS since age 16.',
      '## How Common Is PCOS/PCOD in India?',
      'ICMR task force studies show prevalence rates ranging from 3.7% to 22.5% among Indian women. In urban cohorts, up to 17.4% of young women screened positive, with nearly 30% of cases newly diagnosed during testing.',
      '## PCOS vs PCOD: Understanding the Difference',
      'PCOD (Polycystic Ovarian Disease) involves ovaries producing immature eggs that form cysts; it is milder, more common, and has less impact on fertility. PCOS (Polycystic Ovary Syndrome) is a broader endocrine-metabolic disorder involving androgen excess, insulin resistance, and irregular ovulation.',
      '## Key Symptoms to Watch',
      '• Irregular or missed cycles (fewer than 8 periods a year)\n• Hirsutism (excess facial or body hair) and scalp thinning\n• Persistent hormonal acne along the jawline\n• Insulin resistance signs (dark skin patches around neck/underarms)\n• Unpredictable heavy flow or prolonged spotting',
      '> PCOS is a manageable chronic condition, not a sentence. Early medical diagnosis combined with lifestyle care changes everything.',
      '## Medical Diagnosis & Management',
      'Diagnosis involves clinical history, hormone panel blood tests, and ultrasound. Evidence-backed management focuses on blood sugar stabilization, gentle exercise, anti-androgen support, and stress management.',
    ],
  },
  {
    slug: 'cortisol-womens-health-calm-stress-response',
    title: 'How Cortisol Affects Women’s Health - and How to Calm Your Stress Response',
    category: 'Skin & Body',
    excerpt:
      'Cortisol quietly shapes women’s periods, sleep, weight, and mood. Learn what it does inside a woman’s body and science-backed ways to calm your stress response.',
    author: 'Aarti Menon',
    date: 'June 18, 2026',
    readTime: 8,
    tone: CATEGORY_META['Skin & Body'].tint,
    image: '/assets/img/blogs/cortisol-womens-health.png',
    featured: false,
    body: [
      'Have you ever noticed how your period goes haywire during your most stressful months? Or how you can eat carefully and still gain weight around your middle when life feels overwhelming? Cortisol - the primary stress hormone - is often the hidden link.',
      '## What Is Cortisol?',
      'Produced by the adrenal glands, cortisol drives the fight-or-flight response. It raises heart rate and blood sugar while pausing "non-essential" functions like digestion and reproduction to handle emergencies.',
      '## When Stress Never Switches Off',
      'In modern life, chronic stress keeps cortisol elevated. For women, this directly impacts the HPG axis (the brain-to-ovary signaling pathway), leading to delayed ovulation, irregular cycles, painful PMS, or missed periods.',
      '## How High Cortisol Manifests',
      '1. Irregular or missed periods (stress-induced delayed ovulation)\n2. Abdominal weight retention due to blood sugar spikes\n3. Disrupted sleep (tired-yet-wired feeling at night)\n4. Heightened anxiety and mood shifts before periods',
      '> Calming your stress response isn’t about doing more; it’s about giving your body permission to rest.',
      '## Science-Backed Ways to Lower Cortisol',
      '• Diaphragmatic breathing (4-second inhale, 6-second exhale)\n• Consistent bedtime and morning daylight exposure\n• Balanced meals with protein to prevent blood sugar crashes\n• Gentle movement (walking, yoga) over grueling workouts',
    ],
  },
  {
    slug: 'body-image-social-media-young-women-india',
    title: 'Body Image and Social Media: What It’s Doing to Young Women in India',
    category: 'Community',
    excerpt:
      'How social media shapes body image in young Indian women - research insights, beauty filters, algorithm loops, and practical ways to protect your confidence.',
    author: 'Aarti Menon',
    date: 'June 10, 2026',
    readTime: 9,
    tone: CATEGORY_META.Community.tint,
    image: '/assets/img/blogs/body-image-social-media.png',
    featured: false,
    body: [
      'She was fourteen the first time she deleted a photo of herself - not because anything was wrong with it, but because she held it next to a reel she had watched forty times that week.',
      '## What the Research Shows',
      'A 2025 study of Indian adolescents found that 33.1% of young women screened positive for body dysmorphic concerns. Spending more than 4 hours daily on image-based platforms correlated with significantly higher body dissatisfaction.',
      '## Why Social Media Comparison Hurts',
      '• Endless Sample Size: You compare your unedited Tuesday morning against someone else’s best frame of the year.\n• Filter Realities: Real-time beauty filters redefine baseline standards, creating "Snapchat dysmorphia."\n• Algorithmic Insecurity Loops: Platforms feed more appearance content whenever you pause on a transformation clip.',
      '## Puberty & Period Alignment',
      'For most Indian girls, heavy social media use coincides with puberty and their first period - hips widening, skin breaking out, cramps arriving. Combined with period secrecy, changing bodies can feel like something to hide.',
      '> Your body is not a rough draft awaiting edits. It is the only one you get, and it carries you through every single day.',
      '## Practical Confidence Steps',
      'Curate your feed ruthlessly, protect the first and last 10 minutes of your day from screens, adopt body neutrality ("my body is doing its job"), and prioritize physical comfort during periods.',
    ],
  },
  {
    slug: 'sleep-and-womens-hormones',
    title: 'Sleep and Women’s Hormones: Why Women’s Sleep Problems Are Different',
    category: 'Cycle & Hormones',
    excerpt:
      'Women face a far higher risk of insomnia than men - and hormones explain much of it. A cycle-by-cycle guide to why your sleep changes and how to sleep better.',
    author: 'Dr. Gomathi',
    date: 'June 2, 2026',
    readTime: 8,
    tone: CATEGORY_META['Cycle & Hormones'].tint,
    image: '/assets/img/blogs/sleep-womens-hormones.png',
    featured: false,
    body: [
      'It is 2:40 in the morning. The house is quiet, but you lie wide awake. Women are 40% more likely to experience insomnia than men, and biological hormonal shifts are the primary driver.',
      '## Sleep Across the Menstrual Cycle',
      '• Follicular Phase: Rising estrogen promotes deep REM sleep and steady energy.\n• Luteal Phase: Progesterone spikes body temperature by 0.3-0.5°C and drops rapidly before bleeding, triggering night awakenings and premenstrual insomnia.',
      '## Period Night Anxiety & Leaks',
      'Waking up to check for leaks disrupts deep restorative sleep cycles. Using long, double-winged overnight pads (330mm or 425mm) provides full coverage so your mind can rest completely.',
      '> Good sleep hygiene on your period requires both hormonal awareness and zero-leak peace of mind.',
      '## Tips for Restful Sleep',
      'Maintain a cool bedroom temperature (18-20°C), avoid caffeine after 2 PM, use warm compresses for cramps, and choose ultra-absorbent, breathable organic pads.',
    ],
  },
  {
    slug: 'panty-liner-vs-pad-when-to-use-which',
    title: 'Panty Liner vs Sanitary Pad: When to Use Which for Daily Freshness',
    category: 'Product Guides',
    excerpt:
      'Confused between panty liners and sanitary pads? Learn when to use panty liners for ovulation discharge, spotting, and daily protection versus pads for period flow.',
    author: 'Femi9 Team',
    date: 'May 25, 2026',
    readTime: 5,
    tone: CATEGORY_META['Product Guides'].tint,
    image: '/assets/img/blogs/panty-liner-vs-pad.png',
    featured: false,
    body: [
      'Panty liners and sanitary pads may look similar, but they serve distinct purposes in your intimate hygiene routine.',
      '## What Is a Panty Liner?',
      'Panty liners are ultra-thin, lightweight absorbent strips designed for light daily discharge, ovulation fluid, pre-period spotting, or post-period tapering days.',
      '## What Is a Sanitary Pad?',
      'Sanitary pads are thicker, multi-layered absorbent products specifically designed to lock in active menstrual flow and prevent leaks during your period.',
      '## When to Use Which?',
      '• Use Panty Liners: Daily freshness, ovulation moisture, tampon/cup backup, light bladder leaks.\n• Use Sanitary Pads: Active period days (Days 1-5), heavy flow, overnight sleep protection.',
      '> Using the right product for the right day keeps you feeling fresh and prevents unnecessary bulk.',
    ],
  },
  {
    slug: 'hpv-cervical-cancer-awareness-guide',
    title: 'HPV and Cervical Cancer Awareness: What Every Woman Needs to Know',
    category: 'Skin & Body',
    excerpt:
      'Understanding HPV transmission, PAP smear screenings, cervical cancer vaccination, and preventive intimate care for women in India.',
    author: 'Dr. Gomathi',
    date: 'May 15, 2026',
    readTime: 7,
    tone: CATEGORY_META['Skin & Body'].tint,
    image: '/assets/img/blogs/hpv-awareness.png',
    featured: false,
    body: [
      'Cervical cancer is the second most common cancer among women in India, yet it is almost entirely preventable through early awareness, HPV vaccination, and regular screening.',
      '## What Is HPV?',
      'Human Papillomavirus (HPV) is a common virus transmitted through skin-to-skin contact. While most strains resolve naturally, high-risk strains can cause cellular changes over time if undetected.',
      '## Prevention & Screening Steps',
      '1. HPV Vaccination: Recommended for young women and adolescents for long-term immunity.\n2. PAP Smear Screening: Simple, painless routine screening starting from age 21-25.\n3. Breathable Intimate Hygiene: Keeping the vaginal area clean, dry, and chemical-free supports natural mucosal immunity.',
      '> Cervical health begins with open conversations and routine preventive care.',
    ],
  },
]

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug)
}

export function relatedPosts(post: BlogPost, n = 3): BlogPost[] {
  const sameCat = POSTS.filter((p) => p.slug !== post.slug && p.category === post.category)
  const others = POSTS.filter((p) => p.slug !== post.slug && p.category !== post.category)
  return [...sameCat, ...others].slice(0, n)
}
