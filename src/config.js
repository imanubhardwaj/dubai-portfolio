// ─────────────────────────────────────────────────────────────
//  EDIT ME — all portfolio content lives here.
//  World coordinates are metres: +x east, -z north, car heading h
//  faces (sin h, cos h).
// ─────────────────────────────────────────────────────────────

export const PROFILE = {
  name: 'Manu',
  role: 'Software Engineer',
  email: 'manu@sola-solutions.com',
  github: 'https://github.com/',
  linkedin: 'https://linkedin.com/',
};

// land: where the landmark stands. stop: where the car parks (must be drivable).
// focus: point (x, y, z offset from land) the cinematic camera tilts up to.
export const CHECKPOINTS = [
  {
    id: 'about',
    title: 'About',
    landmark: 'Burj Al Arab',
    icon: '◐',
    color: '#ffd166',
    land: [-545, -330],
    stop: [-318, -330],
    focus: [0, 110, 0],
    pin: 200,
    kicker: 'Who is behind the wheel',
    headline: 'Hi, I’m Manu.',
    blocks: [
      { t: 'text', v: 'I’m a software engineer who loves building sharp, fast, thoughtful products — from the data model all the way to the last pixel. I care about craft, clear systems and shipping things people actually enjoy using.' },
      { t: 'text', v: 'Replace this paragraph with your own story: where you’re from, what you’re obsessed with, and what you’re looking for next.' },
      { t: 'stats', v: [['6+', 'Years building'], ['40+', 'Projects shipped'], ['12', 'Teams worked with']] },
      { t: 'chips', v: ['Product minded', 'Systems thinker', 'Design-literate', 'Fast learner', 'Open source'] },
    ],
  },
  {
    id: 'projects',
    title: 'Projects',
    landmark: 'Burj Khalifa',
    icon: '◆',
    color: '#4cc9f0',
    land: [300, -850],
    stop: [300, -440],
    focus: [0, 430, 0],
    pin: 760,
    kicker: 'Things I’ve built',
    headline: 'Selected work',
    blocks: [
      {
        t: 'cards',
        v: [
          { title: 'Workflow Engine', text: 'A visual editor and execution engine for building automations — typed ports, live compile feedback and a run timeline.', tags: ['TypeScript', 'React', 'DSL'], link: '#' },
          { title: 'Realtime Dashboard', text: 'Analytics surface streaming millions of events with sub-second filtering and shareable views.', tags: ['Next.js', 'ClickHouse', 'WebSockets'], link: '#' },
          { title: 'Design System', text: 'A themeable component library with accessibility baked in, used across a dozen products.', tags: ['React', 'Storybook', 'A11y'], link: '#' },
          { title: 'This Portfolio', text: 'A fully procedural 3D Dubai you can drive through — no models, just maths and Three.js.', tags: ['Three.js', 'WebGL', 'Vite'], link: '#' },
        ],
      },
    ],
  },
  {
    id: 'skills',
    title: 'Skills',
    landmark: 'Palm Jumeirah',
    icon: '✦',
    color: '#80ed99',
    land: [-1262, 500],
    stop: [-1030, 500],
    focus: [0, 70, 0],
    pin: 120,
    kicker: 'The toolbox',
    headline: 'What I work with',
    blocks: [
      {
        t: 'bars',
        v: [
          ['TypeScript / JavaScript', 95],
          ['React & Next.js', 92],
          ['Node.js & APIs', 88],
          ['Three.js / WebGL', 78],
          ['SQL & Data modelling', 82],
          ['Cloud & DevOps', 72],
        ],
      },
      { t: 'chips', v: ['TypeScript', 'React', 'Next.js', 'Node', 'PostgreSQL', 'ClickHouse', 'GraphQL', 'Docker', 'AWS', 'Three.js', 'Tailwind', 'Vitest'] },
    ],
  },
  {
    id: 'experience',
    title: 'Experience',
    landmark: 'Dubai Frame',
    icon: '▣',
    color: '#ff9e6d',
    land: [650, 40],
    stop: [650, 292],
    focus: [0, 85, 0],
    pin: 160,
    kicker: 'The road so far',
    headline: 'Experience',
    blocks: [
      {
        t: 'timeline',
        v: [
          { when: '2023 — Now', what: 'Software Engineer · Sola Solutions', text: 'Building the next-generation workflow engine and its editor.' },
          { when: '2021 — 2023', what: 'Full-stack Engineer · Previous Co.', text: 'Owned features end-to-end across web and API; led the dashboard rebuild.' },
          { when: '2019 — 2021', what: 'Junior Developer · Studio', text: 'Shipped client sites and learned to love performance budgets.' },
        ],
      },
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    landmark: 'Museum of the Future',
    icon: '✉',
    color: '#c77dff',
    land: [120, 560],
    stop: [120, 752],
    focus: [0, 60, 0],
    pin: 130,
    kicker: 'Let’s build something',
    headline: 'Get in touch',
    blocks: [
      { t: 'text', v: 'Have a project, a role, or just an idea worth chasing? My inbox is always open.' },
      {
        t: 'links',
        v: [
          ['Email', PROFILE.email, `mailto:${PROFILE.email}`],
          ['GitHub', 'github.com', PROFILE.github],
          ['LinkedIn', 'linkedin.com', PROFILE.linkedin],
        ],
      },
    ],
  },
  {
    id: 'writing',
    title: 'Writing',
    landmark: 'Cayan Tower',
    icon: '✎',
    color: '#f72585',
    land: [-90, 1340],
    stop: [-90, 1198],
    focus: [0, 160, 0],
    pin: 300,
    kicker: 'Notes from the garage',
    headline: 'Writing & talks',
    blocks: [
      {
        t: 'cards',
        v: [
          { title: 'Designing a typed workflow DSL', text: 'What we learned compiling visual graphs into something you can reason about.', tags: ['Article'], link: '#' },
          { title: 'Rendering a city in 600 draw calls', text: 'Instancing, merging and cheating gracefully in Three.js.', tags: ['Article'], link: '#' },
        ],
      },
    ],
  },
];

export const START = { pos: [8, 330], heading: Math.PI }; // on Sheikh Zayed Road, facing north
