import type { HelpGuide, HelpLang } from "./types";

/**
 * In-app help: one guide per page plus setup topics, each in Tamil and
 * English. Plain words, written for a sales/marketing teammate — not a
 * developer. Keep steps short; one action per step.
 */
export const HELP_GUIDES: HelpGuide[] = [
  // ------------------------------------------------------------------
  {
    id: "getting-started",
    route: null,
    group: "start",
    title: { en: "Getting started", ta: "தொடங்குவது எப்படி" },
    summary: {
      en: "First-day setup: connect WhatsApp, add your apps, bring in contacts and send your first campaign.",
      ta: "முதல் நாள் setup: WhatsApp இணைப்பு, உங்கள் apps சேர்ப்பது, contacts கொண்டுவருவது, முதல் campaign அனுப்புவது.",
    },
    sections: [
      {
        heading: { en: "Set up in this order", ta: "இந்த வரிசையில் setup செய்யுங்கள்" },
        steps: [
          {
            en: "Settings → WhatsApp: paste your Meta Cloud API details and save. The status should turn to Connected and Registered.",
            ta: "Settings → WhatsApp: Meta Cloud API விவரங்களை paste செய்து Save செய்யுங்கள். Status 'Connected', 'Registered' என்று மாற வேண்டும்.",
          },
          {
            en: "Settings → Apps: add each product you market — for example Nixie CRM and your payment app.",
            ta: "Settings → Apps: நீங்கள் விற்கும் ஒவ்வொரு product-ஐயும் சேர்க்கவும் — உதா. Nixie CRM, payment app.",
          },
          {
            en: "Settings → Templates: create or sync your approved message templates. Campaigns can only use approved templates.",
            ta: "Settings → Templates: approved message templates-ஐ உருவாக்கவும் அல்லது sync செய்யவும். Campaign-க்கு approved template மட்டுமே பயன்படும்.",
          },
          {
            en: "Contacts → Import: upload a CSV of your leads. Pick the app in the top bar first so they are tagged to it.",
            ta: "Contacts → Import: leads CSV-ஐ upload செய்யவும். முதலில் மேலே உள்ள bar-ல் app-ஐ தேர்வு செய்தால் அந்த app tag சேரும்.",
          },
          {
            en: "Settings → Team members: invite your teammates with the right role.",
            ta: "Settings → Team members: உங்கள் team-ஐ சரியான role-உடன் invite செய்யுங்கள்.",
          },
          {
            en: "Broadcasts → New: send your first template campaign to one app's contacts.",
            ta: "Broadcasts → New: ஒரு app-ன் contacts-க்கு முதல் template campaign அனுப்புங்கள்.",
          },
        ],
      },
      {
        heading: { en: "The 24-hour rule", ta: "24 மணி நேர விதி" },
        body: {
          en: "WhatsApp lets you send free-form messages only within 24 hours of the customer's last message. Outside that window you must send an approved template. The inbox shows when a chat's window is about to close.",
          ta: "Customer கடைசியாக message அனுப்பிய 24 மணி நேரத்துக்குள் மட்டுமே சாதாரண message அனுப்ப முடியும். அதற்கு பிறகு approved template மட்டுமே அனுப்ப வேண்டும். Window மூடப்போகும் chats-ஐ inbox காட்டும்.",
        },
      },
      {
        heading: { en: "Who can do what", ta: "யார் என்ன செய்யலாம்" },
        points: [
          { en: "Owner — everything, including transferring the account.", ta: "Owner — எல்லாமே, account-ஐ மாற்றுவது உட்பட." },
          { en: "Admin — settings, apps, templates, team and API keys.", ta: "Admin — settings, apps, templates, team, API keys." },
          { en: "Agent — chats, contacts, deals and campaigns.", ta: "Agent — chats, contacts, deals, campaigns." },
          { en: "Viewer — can look, cannot change anything.", ta: "Viewer — பார்க்க மட்டும், எதையும் மாற்ற முடியாது." },
        ],
      },
    ],
    related: ["whatsapp-connection", "apps", "broadcasts"],
  },

  // ------------------------------------------------------------------
  {
    id: "dashboard",
    route: "/dashboard",
    group: "start",
    title: { en: "Dashboard", ta: "Dashboard" },
    summary: {
      en: "What needs you today: customers waiting for a reply, campaign results and pipeline value.",
      ta: "இன்று உங்களுக்கு என்ன வேலை: பதிலுக்காக காத்திருக்கும் customers, campaign முடிவுகள், pipeline மதிப்பு.",
    },
    sections: [
      {
        heading: { en: "Reading the page", ta: "இந்த page-ஐ புரிந்துகொள்வது" },
        points: [
          {
            en: "Attention row — chats waiting for a reply and failed messages. Clear these first.",
            ta: "Attention row — பதில் தேவைப்படும் chats மற்றும் fail ஆன messages. இவற்றை முதலில் முடிக்கவும்.",
          },
          {
            en: "Reply queue — the oldest unanswered customers at the top.",
            ta: "Reply queue — நீண்ட நேரமாக பதில் கிடைக்காத customers மேலே இருப்பார்கள்.",
          },
          {
            en: "Message volume and campaigns — how many messages went out and how many were read.",
            ta: "Message volume, campaigns — எத்தனை messages போனது, எத்தனை படிக்கப்பட்டது.",
          },
          {
            en: "Pipeline — open deal value per stage.",
            ta: "Pipeline — ஒவ்வொரு stage-லும் உள்ள deals மதிப்பு.",
          },
          {
            en: "WhatsApp health chip — your number's quality rating from Meta. Keep it green by sending messages people want.",
            ta: "WhatsApp health — Meta தரும் உங்கள் number-ன் quality rating. மக்கள் விரும்பும் messages மட்டும் அனுப்பி இதை green-ஆக வைக்கவும்.",
          },
        ],
      },
      {
        heading: { en: "Setup checklist", ta: "Setup checklist" },
        body: {
          en: "Until setup is complete the dashboard shows a checklist. Each item links to the page that finishes it.",
          ta: "Setup முடியும் வரை dashboard-ல் ஒரு checklist தெரியும். ஒவ்வொரு item-ஐ click செய்தால் அந்த page-க்கு போகும்.",
        },
      },
    ],
    related: ["getting-started", "inbox"],
  },

  // ------------------------------------------------------------------
  {
    id: "inbox",
    route: "/inbox",
    group: "conversations",
    title: { en: "Inbox", ta: "Inbox" },
    summary: {
      en: "Every WhatsApp chat in one place, shared by the whole team.",
      ta: "எல்லா WhatsApp chats-உம் ஒரே இடத்தில், முழு team-உம் பகிர்ந்து பயன்படுத்தலாம்.",
    },
    sections: [
      {
        heading: { en: "Reply to a customer", ta: "Customer-க்கு பதில் அனுப்புவது" },
        steps: [
          { en: "Pick a chat from the list on the left.", ta: "இடது பக்க list-ல் ஒரு chat-ஐ தேர்வு செய்யுங்கள்." },
          {
            en: "Type in the box at the bottom. Saved quick replies and templates are in the + menu beside it — use a template once the 24-hour window has closed.",
            ta: "கீழே உள்ள box-ல் type செய்யுங்கள். சேமித்த quick replies, templates அருகிலுள்ள + menu-ல் இருக்கும் — 24 மணி window மூடிவிட்டால் template பயன்படுத்துங்கள்.",
          },
          {
            en: "Attach a photo, PDF or voice note with the icons beside the box.",
            ta: "Box அருகில் உள்ள icons மூலம் photo, PDF அல்லது voice note அனுப்பலாம்.",
          },
          {
            en: "Assign the chat to yourself or a teammate, then set it to Pending or Closed when done.",
            ta: "Chat-ஐ உங்களுக்கோ teammate-க்கோ assign செய்யுங்கள்; முடிந்ததும் Pending அல்லது Closed ஆக மாற்றுங்கள்.",
          },
        ],
      },
      {
        heading: { en: "Filters", ta: "Filters" },
        points: [
          { en: "Unread — new messages you haven't opened.", ta: "Unread — நீங்கள் திறக்காத புதிய messages." },
          { en: "Waiting — the customer wrote last and is waiting for you.", ta: "Waiting — customer கடைசியாக எழுதி, உங்கள் பதிலுக்கு காத்திருக்கிறார்." },
          { en: "Unassigned — open chats nobody owns yet.", ta: "Unassigned — யாருக்கும் assign ஆகாத chats." },
          { en: "Expiring — the 24-hour window closes within 2 hours. Reply now.", ta: "Expiring — 24 மணி window இன்னும் 2 மணி நேரத்தில் மூடும். இப்போதே பதில் அனுப்புங்கள்." },
        ],
      },
      {
        heading: { en: "Working per app", ta: "App வாரியாக வேலை செய்வது" },
        body: {
          en: "Choose an app in the top bar to see only chats with that app's contacts. Choose All apps to see everything.",
          ta: "மேலே உள்ள bar-ல் ஒரு app-ஐ தேர்வு செய்தால் அந்த app contacts-ன் chats மட்டும் தெரியும். எல்லாம் பார்க்க 'All apps' தேர்வு செய்யுங்கள்.",
        },
        tip: {
          en: "The AI draft button writes a reply from your knowledge base. Always read it before sending.",
          ta: "AI draft button உங்கள் knowledge base-ஐ வைத்து பதில் எழுதும். அனுப்பும் முன் கட்டாயம் ஒருமுறை படியுங்கள்.",
        },
      },
    ],
    related: ["notifications", "templates", "ai-agents"],
  },

  // ------------------------------------------------------------------
  {
    id: "notifications",
    route: "/notifications",
    group: "conversations",
    title: { en: "Notifications", ta: "Notifications" },
    summary: {
      en: "Chats a teammate has assigned to you.",
      ta: "Teammate உங்களுக்கு assign செய்த chats.",
    },
    sections: [
      {
        heading: { en: "Using notifications", ta: "Notifications பயன்படுத்துவது" },
        points: [
          {
            en: "A new item appears when someone assigns you a conversation. Click it to open the chat.",
            ta: "யாராவது உங்களுக்கு chat assign செய்தால் புதிய item வரும். Click செய்தால் chat திறக்கும்.",
          },
          {
            en: "Mark all as read clears the count in the sidebar.",
            ta: "'Mark all as read' அழுத்தினால் sidebar count அழியும்.",
          },
          {
            en: "Turn on browser alerts in Settings → Your profile to hear about new messages while working in another tab.",
            ta: "Settings → Your profile-ல் browser alerts on செய்தால், வேறு tab-ல் வேலை செய்யும்போதும் புதிய message தெரியும்.",
          },
        ],
      },
    ],
    related: ["inbox"],
  },

  // ------------------------------------------------------------------
  {
    id: "contacts",
    route: "/contacts",
    group: "customers",
    title: { en: "Contacts", ta: "Contacts" },
    summary: {
      en: "Your customers and leads, with tags, custom fields and notes.",
      ta: "உங்கள் customers மற்றும் leads — tags, custom fields, notes உடன்.",
    },
    sections: [
      {
        heading: { en: "Add contacts", ta: "Contacts சேர்ப்பது" },
        steps: [
          {
            en: "Pick the app in the top bar if these people belong to one product.",
            ta: "இவர்கள் ஒரு product-க்கு சொந்தமானவர்கள் என்றால் முதலில் மேலே app-ஐ தேர்வு செய்யுங்கள்.",
          },
          {
            en: "Click Add contact for one person, or Import to upload a CSV with phone, name and email columns.",
            ta: "ஒருவருக்கு 'Add contact'; பலருக்கு phone, name, email columns உள்ள CSV-ஐ 'Import' மூலம் upload செய்யுங்கள்.",
          },
          {
            en: "Phone numbers need the country code, for example +91 98765 43210.",
            ta: "Phone number-ல் country code கட்டாயம் — உதா. +91 98765 43210.",
          },
        ],
        tip: {
          en: "A number that already exists is never added twice: the form points you to the existing contact, and Import skips it.",
          ta: "ஏற்கனவே உள்ள number இரண்டாவது முறை சேராது: form பழைய contact-ஐ காட்டும், Import அதை skip செய்யும்.",
        },
      },
      {
        heading: { en: "Find the right people", ta: "சரியான நபர்களை கண்டுபிடிப்பது" },
        points: [
          { en: "Search by name, phone or email.", ta: "Name, phone அல்லது email மூலம் தேடலாம்." },
          { en: "Filter by tags — a contact shows if it has any of the chosen tags.", ta: "Tags மூலம் filter — தேர்ந்தெடுத்த tags-ல் ஏதாவது ஒன்று இருந்தாலும் contact தெரியும்." },
          { en: "Custom fields store extra details like city, plan or dealer code.", ta: "City, plan, dealer code போன்ற கூடுதல் விவரங்களை custom fields-ல் சேமிக்கலாம்." },
        ],
      },
      {
        heading: { en: "One person, several apps", ta: "ஒருவர், பல apps" },
        body: {
          en: "Apps are tags. A dealer who uses Nixie CRM and also your payment app simply carries both app tags, and appears under both apps.",
          ta: "Apps என்பது tags தான். Nixie CRM-உம் payment app-உம் பயன்படுத்தும் dealer-க்கு இரண்டு app tags-உம் இருக்கும்; இரண்டு app-லும் தெரிவார்.",
        },
      },
    ],
    related: ["apps", "broadcasts", "pipelines"],
  },

  // ------------------------------------------------------------------
  {
    id: "pipelines",
    route: "/pipelines",
    group: "customers",
    title: { en: "Pipelines", ta: "Pipelines" },
    summary: {
      en: "Track each lead from first message to payment on a board.",
      ta: "முதல் message முதல் payment வரை ஒவ்வொரு lead-ஐயும் board-ல் track செய்யுங்கள்.",
    },
    sections: [
      {
        heading: { en: "Work a deal", ta: "Deal-ஐ நகர்த்துவது" },
        steps: [
          { en: "Choose the pipeline at the top — each app can have its own.", ta: "மேலே pipeline-ஐ தேர்வு செய்யுங்கள் — ஒவ்வொரு app-க்கும் தனி pipeline இருக்கலாம்." },
          { en: "Click New deal, pick the contact and enter the value.", ta: "'New deal' அழுத்தி contact-ஐ தேர்வு செய்து value-ஐ கொடுங்கள்." },
          { en: "Drag the card to the next stage as the lead moves forward.", ta: "Lead முன்னேறும்போது card-ஐ அடுத்த stage-க்கு drag செய்யுங்கள்." },
          { en: "Move it to Won or Lost when it's decided.", ta: "முடிவு தெரிந்ததும் Won அல்லது Lost-க்கு மாற்றுங்கள்." },
        ],
      },
      {
        heading: { en: "Stages and analytics", ta: "Stages, analytics" },
        points: [
          { en: "Admins can rename, reorder and recolour stages in the pipeline settings.", ta: "Admins pipeline settings-ல் stages-ன் பெயர், வரிசை, நிறம் மாற்றலாம்." },
          { en: "Analytics shows value per stage and your win rate.", ta: "Analytics-ல் stage வாரியான மதிப்பும் win rate-உம் தெரியும்." },
          { en: "Currency is set in Settings → Deals & currency.", ta: "Currency-ஐ Settings → Deals & currency-ல் மாற்றலாம்." },
        ],
      },
    ],
    related: ["contacts", "apps"],
  },

  // ------------------------------------------------------------------
  {
    id: "bookings",
    route: "/bookings",
    group: "customers",
    title: { en: "Bookings", ta: "Bookings" },
    summary: {
      en: "Every demo, visit and callback the AI agent agrees in chat, as a task and on the calendar.",
      ta: "AI agent chat-ல் உறுதி செய்யும் ஒவ்வொரு demo, visit, callback-உம் task-ஆகவும் calendar-லும் தெரியும்.",
    },
    sections: [
      {
        heading: { en: "Set it up", ta: "Setup செய்வது" },
        steps: [
          { en: "Go to Settings → Booking types and check the business timezone.", ta: "Settings → Booking types-க்கு சென்று business timezone-ஐ சரிபாருங்கள்." },
          { en: "Click New type and name it, for example Online demo or Installation.", ta: "'New type' அழுத்தி பெயர் கொடுங்கள் — உதா. Online demo அல்லது Installation." },
          { en: "List the details the AI should collect, and mark the ones it must have.", ta: "AI கேட்க வேண்டிய விவரங்களைச் சேர்த்து, கட்டாயமானவற்றை Required என்று குறியுங்கள்." },
          { en: "Set the working days and hours, and how many bookings can run at the same time.", ta: "வேலை நாட்கள், நேரம், ஒரே நேரத்தில் எத்தனை bookings நடக்கலாம் என்பதை அமைக்கவும்." },
          { en: "Choose who follows up, then test it in AI Agents → Playground.", ta: "யார் follow up செய்வார் என்று தேர்வு செய்து, AI Agents → Playground-ல் test செய்யுங்கள்." },
        ],
      },
      {
        heading: { en: "Follow up", ta: "Follow up செய்வது" },
        points: [
          { en: "Tasks lists what needs doing, with anything marked Needs review on top.", ta: "Tasks-ல் செய்ய வேண்டியவை தெரியும்; Needs review உள்ளவை மேலே இருக்கும்." },
          { en: "Needs review means a required detail or the time is missing. Open it and fill the gap with the customer.", ta: "Needs review என்றால் கட்டாய விவரம் அல்லது நேரம் இல்லை. அதைத் திறந்து customer-உடன் சரிசெய்யுங்கள்." },
          { en: "Calendar shows everything that has a date and time.", ta: "தேதி, நேரம் உள்ள அனைத்தும் Calendar-ல் தெரியும்." },
          { en: "The assigned agent gets a notification, and a reminder before the time.", ta: "Assign செய்யப்பட்ட agent-க்கு notification-உம், நேரத்துக்கு முன் reminder-உம் வரும்." },
          { en: "The AI only books free slots. If a time is taken or outside working hours, it offers free times instead.", ta: "AI free slots-ல் மட்டுமே book செய்யும். நேரம் booked ஆக இருந்தால் அல்லது வேலை நேரத்துக்கு வெளியே இருந்தால், free நேரங்களை சொல்லும்." },
          { en: "A contact has one open booking per type. If the customer asks for another, the AI asks whether to change it or close it and book a new one.", ta: "ஒரு contact-க்கு ஒரு type-ல் ஒரு open booking மட்டுமே. Customer இன்னொன்று கேட்டால், அதை மாற்றவா அல்லது close செய்து புதிதாக book செய்யவா என்று AI கேட்கும்." },
          { en: "When an agent runs the chat, what they agree is recorded automatically. If that slot is full, the booking appears as Needs review.", ta: "Agent chat செய்யும்போதும், உறுதியானது தானாக பதிவாகும். அந்த slot full என்றால் booking Needs review-ஆக வரும்." },
        ],
      },
    ],
    related: ["contacts", "pipelines"],
  },

  // ------------------------------------------------------------------
  {
    id: "broadcasts",
    route: "/broadcasts",
    group: "campaigns",
    title: { en: "Broadcasts", ta: "Broadcasts (Campaigns)" },
    summary: {
      en: "Send an approved template to many contacts at once and track delivery, reads and replies.",
      ta: "Approved template-ஐ ஒரே நேரத்தில் பல contacts-க்கு அனுப்பி delivery, read, reply-ஐ track செய்யுங்கள்.",
    },
    sections: [
      {
        heading: { en: "Send a campaign", ta: "Campaign அனுப்புவது" },
        steps: [
          { en: "Pick the app in the top bar, then click New broadcast.", ta: "மேலே app-ஐ தேர்வு செய்து 'New broadcast' அழுத்துங்கள்." },
          { en: "Choose an approved template.", ta: "Approved template ஒன்றை தேர்வு செய்யுங்கள்." },
          {
            en: "Choose the audience: everyone, contacts with certain tags (the app's tag is pre-selected), a custom field, or a CSV. You can exclude tags too.",
            ta: "Audience: எல்லோரும், குறிப்பிட்ட tags உள்ளவர்கள் (app tag தானாக தேர்வாகும்), custom field, அல்லது CSV. சில tags-ஐ விலக்கவும் முடியும்.",
          },
          { en: "Fill the template variables, e.g. {{1}} = contact name.", ta: "Template variables-ஐ நிரப்புங்கள் — உதா. {{1}} = contact name." },
          { en: "Send now or schedule a time.", ta: "இப்போதே அனுப்பலாம் அல்லது நேரம் schedule செய்யலாம்." },
        ],
        tip: {
          en: "Keep your quality rating high: send only to people who agreed to hear from you, and give them a way to stop.",
          ta: "Quality rating குறையாமல் இருக்க: அனுமதி கொடுத்தவர்களுக்கு மட்டும் அனுப்புங்கள்; நிறுத்த ஒரு வழியும் கொடுங்கள்.",
        },
      },
      {
        heading: { en: "Results", ta: "முடிவுகள்" },
        points: [
          { en: "Sent → Delivered → Read → Replied counts update live.", ta: "Sent → Delivered → Read → Replied எண்ணிக்கை live-ஆக update ஆகும்." },
          { en: "Failed recipients show Meta's reason; you can retry them.", ta: "Fail ஆனவர்களுக்கு Meta காரணம் காட்டும்; மீண்டும் retry செய்யலாம்." },
          { en: "Pick an app in the top bar to see only that app's campaigns.", ta: "மேலே app-ஐ தேர்வு செய்தால் அந்த app campaigns மட்டும் தெரியும்." },
        ],
      },
    ],
    related: ["templates", "apps", "automations"],
  },

  // ------------------------------------------------------------------
  {
    id: "automations",
    route: "/automations",
    group: "campaigns",
    title: { en: "Automations", ta: "Automations" },
    summary: {
      en: "Rules that run by themselves: when something happens, do these steps.",
      ta: "தானாக ஓடும் rules: ஒரு நிகழ்வு நடந்தால் இந்த steps-ஐ செய்.",
    },
    sections: [
      {
        heading: { en: "Triggers — when it starts", ta: "Triggers — எப்போது தொடங்கும்" },
        points: [
          { en: "A message arrives, or a contact's first-ever message.", ta: "Message வரும்போது, அல்லது ஒருவரின் முதல் message." },
          { en: "A keyword is matched, e.g. \"price\" or \"demo\".", ta: "Keyword வந்தால் — உதா. \"price\", \"demo\"." },
          { en: "A contact is created, or a tag is added (use the app tag to welcome new sign-ups).", ta: "புதிய contact, அல்லது tag சேர்க்கப்பட்டால் (புதிய sign-up-க்கு welcome அனுப்ப app tag பயன்படுத்துங்கள்)." },
          { en: "A chat is assigned, a button is tapped, or on a schedule.", ta: "Chat assign ஆனால், button அழுத்தினால், அல்லது schedule நேரத்தில்." },
        ],
      },
      {
        heading: { en: "Build one", ta: "ஒன்றை உருவாக்குவது" },
        steps: [
          { en: "Start from a quick-start template or a blank automation.", ta: "Quick-start template அல்லது blank automation-ல் தொடங்குங்கள்." },
          { en: "Choose the trigger.", ta: "Trigger-ஐ தேர்வு செய்யுங்கள்." },
          { en: "Add steps: send a message or template, wait, check a condition, add a tag, call a webhook.", ta: "Steps சேர்க்கவும்: message/template அனுப்பு, காத்திரு, condition சோதி, tag சேர், webhook அழை." },
          { en: "Activate it, then watch View logs for each run.", ta: "Activate செய்து, ஒவ்வொரு run-ஐயும் 'View logs'-ல் பாருங்கள்." },
        ],
        tip: {
          en: "Wait steps need the scheduled job set up on the server (see the deployment guide).",
          ta: "Wait steps வேலை செய்ய server-ல் scheduled job (cron) setup தேவை — deployment guide பாருங்கள்.",
        },
      },
    ],
    related: ["flows", "apps"],
  },

  // ------------------------------------------------------------------
  {
    id: "flows",
    route: "/flows",
    group: "campaigns",
    title: { en: "Flows (beta)", ta: "Flows (beta)" },
    summary: {
      en: "Button-driven chat menus: customers tap options and the bot routes them.",
      ta: "Button menus உள்ள chatbot: customer option அழுத்தினால் bot சரியான பதிலுக்கு அழைத்துச் செல்லும்.",
    },
    sections: [
      {
        heading: { en: "Make a flow", ta: "Flow உருவாக்குவது" },
        steps: [
          { en: "Click New flow and start from a template like a welcome menu.", ta: "'New flow' அழுத்தி welcome menu போன்ற template-ல் தொடங்குங்கள்." },
          { en: "Set how it starts: keywords, a contact's first message, or manual.", ta: "எப்போது தொடங்கும் என அமைக்கவும்: keywords, முதல் message, அல்லது manual." },
          { en: "Add message, button and list nodes, and connect them.", ta: "Message, button, list nodes சேர்த்து இணைக்கவும்." },
          { en: "Fix anything the validation panel flags, then activate.", ta: "Validation panel காட்டும் பிழைகளை சரி செய்து activate செய்யுங்கள்." },
        ],
        tip: {
          en: "Always end a branch with a hand-off to a human so nobody gets stuck.",
          ta: "யாரும் சிக்கிக்கொள்ளாமல் இருக்க ஒவ்வொரு branch-ம் கடைசியில் human agent-க்கு hand-off ஆக வேண்டும்.",
        },
      },
    ],
    related: ["automations", "ai-agents"],
  },

  // ------------------------------------------------------------------
  {
    id: "ai-agents",
    route: "/agents",
    group: "campaigns",
    title: { en: "AI agents", ta: "AI agents" },
    summary: {
      en: "AI-drafted replies and an optional auto-reply bot, using your own AI key and knowledge base.",
      ta: "உங்கள் சொந்த AI key, knowledge base மூலம் AI பதில் drafts மற்றும் auto-reply bot.",
    },
    sections: [
      {
        heading: { en: "Set it up", ta: "Setup செய்வது" },
        steps: [
          { en: "Setup tab: choose the provider (Anthropic Claude, OpenAI or compatible) and paste your API key. It's stored encrypted.", ta: "Setup tab: provider (Anthropic Claude, OpenAI போன்றவை) தேர்வு செய்து API key paste செய்யுங்கள். Encrypted-ஆக சேமிக்கப்படும்." },
          { en: "Add knowledge: pricing, FAQs, policies for each app.", ta: "Knowledge சேர்க்கவும்: ஒவ்வொரு app-ன் pricing, FAQ, policies." },
          { en: "Playground tab: chat as a customer and check the answers.", ta: "Playground tab: customer போல chat செய்து பதில்களை சோதிக்கவும்." },
          { en: "Turn on auto-reply only when the answers are right.", ta: "பதில்கள் சரியாக இருந்தால் மட்டுமே auto-reply on செய்யுங்கள்." },
        ],
      },
      {
        heading: { en: "Safety", ta: "பாதுகாப்பு" },
        points: [
          { en: "The bot hands over to a human when it isn't sure, and stops after a set number of replies per chat.", ta: "உறுதியில்லாதபோது bot human-க்கு hand-off செய்யும்; ஒரு chat-க்கு குறிப்பிட்ட எண்ணிக்கைக்கு மேல் பதில் அனுப்பாது." },
          { en: "Usage tab shows tokens spent on your key.", ta: "Usage tab-ல் உங்கள் key-ல் செலவான tokens தெரியும்." },
        ],
      },
    ],
    related: ["inbox"],
  },

  // ------------------------------------------------------------------
  {
    id: "apps",
    route: "/settings?tab=apps",
    group: "setup",
    title: { en: "Apps — marketing several products", ta: "Apps — பல products-ஐ market செய்வது" },
    summary: {
      en: "Use one WhatsApp number for Nixie CRM, your payment app and future products, each with its own audience.",
      ta: "ஒரே WhatsApp number-ஐ Nixie CRM, payment app, எதிர்கால products எல்லாவற்றுக்கும் — ஒவ்வொன்றுக்கும் தனி audience-உடன்.",
    },
    sections: [
      {
        heading: { en: "Add an app", ta: "App சேர்ப்பது" },
        steps: [
          { en: "Settings → Apps → New app.", ta: "Settings → Apps → New app." },
          { en: "Give it a name, icon and colour. The slug is filled in for you.", ta: "Name, icon, colour கொடுங்கள். Slug தானாக நிரம்பும்." },
          { en: "Leave \"Create a sales pipeline\" on to get a ready board for it.", ta: "\"Create a sales pipeline\" on-ஆக விட்டால் அதற்கு தயாரான board கிடைக்கும்." },
          { en: "Create. A tag with the app's name now marks its contacts.", ta: "Create அழுத்துங்கள். App பெயரில் ஒரு tag உருவாகி அதன் contacts-ஐ குறிக்கும்." },
        ],
      },
      {
        heading: { en: "The app switcher", ta: "App switcher" },
        points: [
          { en: "The switcher in the top bar focuses Contacts, Inbox, Broadcasts and Pipelines on one app.", ta: "மேலே உள்ள switcher, Contacts, Inbox, Broadcasts, Pipelines எல்லாவற்றையும் ஒரு app-க்கு மட்டும் காட்டும்." },
          { en: "The coloured line at the top of the page tells you which app you're in.", ta: "Page மேலே உள்ள நிறக் கோடு நீங்கள் எந்த app-ல் இருக்கிறீர்கள் என்று காட்டும்." },
          { en: "New contacts you add while an app is selected get its tag automatically.", ta: "App தேர்வில் இருக்கும்போது சேர்க்கும் புதிய contacts-க்கு அதன் tag தானாக சேரும்." },
        ],
      },
      {
        heading: { en: "Send sign-ups from your product", ta: "உங்கள் product-லிருந்து sign-ups அனுப்புவது" },
        body: {
          en: "Your app's server can post new users to /api/v1/contacts with \"app\": \"<slug>\". They are added to that app without losing other apps. Create the key in Settings → API keys with contacts:write. Pair it with a \"tag added\" automation to send a welcome template instantly.",
          ta: "உங்கள் app server, புதிய users-ஐ /api/v1/contacts-க்கு \"app\": \"<slug>\" உடன் post செய்யலாம். மற்ற apps நீங்காமல் அந்த app-ல் சேர்வார்கள். Key-ஐ Settings → API keys-ல் contacts:write உடன் உருவாக்குங்கள். \"Tag added\" automation வைத்தால் உடனே welcome template போகும்.",
        },
        tip: {
          en: "Keep the API key on your server only — never in mobile or browser code.",
          ta: "API key-ஐ server-ல் மட்டும் வைக்கவும் — mobile app அல்லது browser code-ல் வைக்கவே கூடாது.",
        },
      },
    ],
    related: ["contacts", "broadcasts", "automations"],
  },

  // ------------------------------------------------------------------
  {
    id: "whatsapp-connection",
    route: "/settings?tab=whatsapp",
    group: "setup",
    title: { en: "Connect WhatsApp (Meta Cloud API)", ta: "WhatsApp இணைப்பு (Meta Cloud API)" },
    summary: {
      en: "Link your official WhatsApp Business number using Meta's Cloud API.",
      ta: "Meta Cloud API மூலம் உங்கள் official WhatsApp Business number-ஐ இணைப்பது.",
    },
    sections: [
      {
        heading: { en: "What you need from Meta", ta: "Meta-விலிருந்து தேவையானவை" },
        points: [
          { en: "Phone Number ID and WhatsApp Business Account (WABA) ID — Meta for Developers → your app → WhatsApp → API Setup.", ta: "Phone Number ID, WABA ID — Meta for Developers → உங்கள் app → WhatsApp → API Setup." },
          { en: "A permanent access token from a System User (Business Settings → System users), with whatsapp_business_messaging and whatsapp_business_management.", ta: "System User-ன் permanent access token (Business Settings → System users) — whatsapp_business_messaging, whatsapp_business_management permissions உடன்." },
          { en: "The 6-digit two-step PIN for a production number (WhatsApp Manager → Phone numbers).", ta: "Production number-க்கு 6 இலக்க two-step PIN (WhatsApp Manager → Phone numbers)." },
        ],
      },
      {
        heading: { en: "Connect it", ta: "இணைப்பது" },
        steps: [
          { en: "Settings → WhatsApp: paste the IDs and token, type a verify token of your own, add the PIN, Save.", ta: "Settings → WhatsApp: IDs, token paste செய்து, சொந்த verify token ஒன்று type செய்து, PIN சேர்த்து Save செய்யுங்கள்." },
          { en: "In Meta → WhatsApp → Configuration, set the callback URL to https://<your domain>/api/whatsapp/webhook and the same verify token.", ta: "Meta → WhatsApp → Configuration-ல் callback URL: https://<உங்கள் domain>/api/whatsapp/webhook, அதே verify token கொடுங்கள்." },
          { en: "Subscribe to the messages field.", ta: "'messages' field-க்கு subscribe செய்யுங்கள்." },
          { en: "Back here, click Verify with Meta. All checks should pass.", ta: "இங்கே திரும்பி 'Verify with Meta' அழுத்துங்கள். எல்லா checks-உம் pass ஆக வேண்டும்." },
        ],
        tip: {
          en: "The server must also have META_APP_SECRET set, or every webhook is rejected for safety.",
          ta: "Server-ல் META_APP_SECRET set ஆகியிருக்க வேண்டும்; இல்லையென்றால் பாதுகாப்புக்காக எல்லா webhooks-உம் reject ஆகும்.",
        },
      },
      {
        heading: { en: "Other providers", ta: "மற்ற providers" },
        body: {
          en: "Meta Cloud API is the provider in use. The connection screen lists other providers (Gupshup, Interakt and more) that can be added later without changing the rest of the CRM.",
          ta: "இப்போது Meta Cloud API பயன்பாட்டில் உள்ளது. Gupshup, Interakt போன்ற மற்ற providers பின்னர் சேர்க்கலாம் — CRM-ன் மற்ற பகுதிகள் மாறாது.",
        },
      },
    ],
    related: ["templates", "getting-started"],
  },

  // ------------------------------------------------------------------
  {
    id: "templates",
    route: "/settings?tab=templates",
    group: "setup",
    title: { en: "Message templates", ta: "Message templates" },
    summary: {
      en: "Pre-approved messages for campaigns and for chats outside the 24-hour window.",
      ta: "Campaigns-க்கும் 24 மணி window-க்கு வெளியே உள்ள chats-க்கும் முன்பே approve ஆன messages.",
    },
    sections: [
      {
        heading: { en: "Create and approve", ta: "உருவாக்கி approve பெறுவது" },
        steps: [
          { en: "Settings → Templates → New template.", ta: "Settings → Templates → New template." },
          { en: "Pick the category: Marketing for offers, Utility for updates, Authentication for OTPs.", ta: "Category: offers-க்கு Marketing, updates-க்கு Utility, OTP-க்கு Authentication." },
          { en: "Write the body. Use {{1}}, {{2}} for parts that change per person.", ta: "Body எழுதுங்கள். ஒவ்வொருவருக்கும் மாறும் இடங்களுக்கு {{1}}, {{2}} பயன்படுத்துங்கள்." },
          { en: "Submit. Meta usually reviews within minutes to a day.", ta: "Submit செய்யுங்கள். Meta பொதுவாக சில நிமிடங்கள் முதல் ஒரு நாளுக்குள் review செய்யும்." },
          { en: "Templates made in WhatsApp Manager appear after Sync.", ta: "WhatsApp Manager-ல் உருவாக்கிய templates 'Sync' செய்த பிறகு தெரியும்." },
        ],
        tip: {
          en: "Tamil templates are fine — choose the Tamil language code (ta) when you create them.",
          ta: "Tamil templates பயன்படுத்தலாம் — உருவாக்கும்போது Tamil language code (ta) தேர்வு செய்யுங்கள்.",
        },
      },
    ],
    related: ["broadcasts", "whatsapp-connection"],
  },

  // ------------------------------------------------------------------
  {
    id: "team-security",
    route: "/settings?tab=members",
    group: "setup",
    title: { en: "Team, logins and security", ta: "Team, login, பாதுகாப்பு" },
    summary: {
      en: "Add teammates safely and keep the CRM private.",
      ta: "Teammates-ஐ பாதுகாப்பாக சேர்ப்பது, CRM-ஐ private-ஆக வைப்பது.",
    },
    sections: [
      {
        heading: { en: "Add a teammate", ta: "Teammate சேர்ப்பது" },
        steps: [
          { en: "The owner creates their login in Supabase → Authentication → Users → Add user (tick auto-confirm).", ta: "Owner, Supabase → Authentication → Users → Add user-ல் அவருக்கு login உருவாக்குவார் (auto-confirm tick செய்யுங்கள்)." },
          { en: "Settings → Team members → Invite: choose the role and copy the link.", ta: "Settings → Team members → Invite: role தேர்வு செய்து link-ஐ copy செய்யுங்கள்." },
          { en: "Send the link. They sign in from it and accept the invite.", ta: "Link-ஐ அனுப்புங்கள். அவர் அதில் sign in செய்து invite-ஐ accept செய்வார்." },
        ],
        tip: {
          en: "Public sign-up is switched off, so nobody outside your team can create a login.",
          ta: "Public sign-up off-ஆக உள்ளது; உங்கள் team தவிர யாரும் login உருவாக்க முடியாது.",
        },
      },
      {
        heading: { en: "Keep it safe", ta: "பாதுகாப்பாக வைப்பது" },
        points: [
          { en: "Use a strong password and sign out on shared computers.", ta: "Strong password பயன்படுத்துங்கள்; பொது computer-ல் sign out செய்யுங்கள்." },
          { en: "Login & security → Sign out everywhere if a device is lost.", ta: "Device தொலைந்தால் Login & security → 'Sign out everywhere'." },
          { en: "Give the lowest role that does the job; remove people who leave.", ta: "தேவையான குறைந்த role மட்டும் கொடுங்கள்; வேலையை விட்டவர்களை உடனே நீக்குங்கள்." },
          { en: "Revoke API keys you no longer use.", ta: "பயன்படுத்தாத API keys-ஐ revoke செய்யுங்கள்." },
          { en: "The CRM tells search engines not to index it, so it won't show on Google.", ta: "Search engines index செய்யக்கூடாது என்று CRM சொல்கிறது — Google-ல் தெரியாது." },
        ],
      },
    ],
    related: ["getting-started"],
  },
];

export function guideById(id: string): HelpGuide | undefined {
  return HELP_GUIDES.find((g) => g.id === id);
}

/**
 * The guide for the page at `pathname` (+ `?tab=` for settings).
 * Longest matching route wins; unknown pages fall back to Getting
 * started so the help button is never empty.
 */
export function guideForPath(pathname: string, tab?: string | null): HelpGuide {
  const full = tab ? `${pathname}?tab=${tab}` : pathname;
  const exact = HELP_GUIDES.find((g) => g.route && g.route === full);
  if (exact) return exact;
  const prefixed = HELP_GUIDES.filter(
    (g) => g.route && !g.route.includes("?") && pathname.startsWith(g.route),
  ).sort((a, b) => (b.route?.length ?? 0) - (a.route?.length ?? 0));
  return prefixed[0] ?? HELP_GUIDES[0];
}

/** Case-insensitive search over titles, summaries and section text in both languages. */
export function searchGuides(query: string): HelpGuide[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_GUIDES;
  return HELP_GUIDES.filter((g) => {
    const texts: string[] = [g.title.en, g.title.ta, g.summary.en, g.summary.ta];
    for (const s of g.sections) {
      texts.push(s.heading.en, s.heading.ta);
      if (s.body) texts.push(s.body.en, s.body.ta);
      for (const x of [...(s.steps ?? []), ...(s.points ?? [])]) texts.push(x.en, x.ta);
      if (s.tip) texts.push(s.tip.en, s.tip.ta);
    }
    return texts.some((t) => t.toLowerCase().includes(q));
  });
}

export function pick(bi: { en: string; ta: string }, lang: HelpLang): string {
  return bi[lang];
}
