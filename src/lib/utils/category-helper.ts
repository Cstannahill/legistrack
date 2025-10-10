// Define the source of truth
const CATEGORIES = {
  healthcare: {
    id: "cmg7fytbq0000vg6k18kspa4q",
    name: "Healthcare",
    slug: "healthcare",
    description:
      "Bills related to healthcare, insurance, medical services, and public health",
    color: "#3B82F6",
    icon: "heart-pulse",
  },
  education: {
    id: "cmg7fytbu0001vg6kwqkx49a9",
    name: "Education",
    slug: "education",
    description: "Education funding, policy, school reform, and student loans",
    color: "#8B5CF6",
    icon: "graduation-cap",
  },
  "environment-climate": {
    id: "cmg7fytbv0002vg6klvv5z7pf",
    name: "Environment & Climate",
    slug: "environment-climate",
    description:
      "Environmental protection, climate change, conservation, and energy policy",
    color: "#10B981",
    icon: "leaf",
  },
  "economy-taxes": {
    id: "cmg7fytbw0003vg6ku8xjua16",
    name: "Economy & Taxes",
    slug: "economy-taxes",
    description:
      "Economic policy, taxation, fiscal matters, and business regulation",
    color: "#F59E0B",
    icon: "dollar-sign",
  },
  "defense-security": {
    id: "cmg7fytbx0004vg6k3xclztrn",
    name: "Defense & National Security",
    slug: "defense-security",
    description: "Military, defense, national security, and foreign policy",
    color: "#EF4444",
    icon: "shield",
  },
  immigration: {
    id: "cmg7fytbx0005vg6ka1txz0x8",
    name: "Immigration",
    slug: "immigration",
    description: "Immigration policy, border security, and citizenship",
    color: "#6366F1",
    icon: "users",
  },
  technology: {
    id: "cmg7fytby0006vg6kwqi3ugel",
    name: "Technology & Innovation",
    slug: "technology",
    description:
      "Technology policy, cybersecurity, telecommunications, and innovation",
    color: "#06B6D4",
    icon: "cpu",
  },
  "civil-rights": {
    id: "cmg7fytbz0007vg6koauerj6j",
    name: "Civil Rights & Justice",
    slug: "civil-rights",
    description:
      "Civil rights, criminal justice reform, voting rights, and police reform",
    color: "#EC4899",
    icon: "scale",
  },
  infrastructure: {
    id: "cmg7fytbz0008vg6kjb817t9j",
    name: "Infrastructure",
    slug: "infrastructure",
    description:
      "Transportation, public works, utilities, and infrastructure development",
    color: "#F97316",
    icon: "building",
  },
  "social-services": {
    id: "cmg7fytc00009vg6kw0yk4oym",
    name: "Social Services",
    slug: "social-services",
    description:
      "Social Security, Medicare, Medicaid, welfare, and social safety net programs",
    color: "#A855F7",
    icon: "hand-helping",
  },
  "labor-employment": {
    id: "cmg7fytc1000avg6kgzgsmwvi",
    name: "Labor & Employment",
    slug: "labor-employment",
    description:
      "Workers rights, labor laws, unemployment, minimum wage, and workplace safety",
    color: "#14B8A6",
    icon: "briefcase",
  },
  "agriculture-food": {
    id: "cmg7fytc2000bvg6kzy7lii91",
    name: "Agriculture & Food",
    slug: "agriculture-food",
    description:
      "Farm policy, food safety, agricultural subsidies, and rural development",
    color: "#84CC16",
    icon: "wheat",
  },
  housing: {
    id: "cmg7fytc3000cvg6kdsn3u9ka",
    name: "Housing & Urban Development",
    slug: "housing",
    description:
      "Housing policy, affordable housing, homelessness, and urban planning",
    color: "#0EA5E9",
    icon: "home",
  },
  "financial-services": {
    id: "cmg7fytc3000dvg6k62refdjd",
    name: "Financial Services",
    slug: "financial-services",
    description:
      "Banking, financial regulation, consumer protection, and monetary policy",
    color: "#22C55E",
    icon: "landmark",
  },
  veterans: {
    id: "cmg7fytc4000evg6kivpvt0hv",
    name: "Veterans Affairs",
    slug: "veterans",
    description:
      "Veterans benefits, VA healthcare, military pensions, and veteran services",
    color: "#DC2626",
    icon: "medal",
  },
} as const;

// Derive types from the constant
export type CategorySlug = keyof typeof CATEGORIES;
export type CategoryName = (typeof CATEGORIES)[CategorySlug]["name"];
export type Category = (typeof CATEGORIES)[CategorySlug];

// For your badge component
export type CategoryBadge = {
  id: string;
  name: CategoryName;
  slug: CategorySlug;
  description: string;
  color: string;
  icon: string;
};

// Helper functions
export const getCategoryBySlug = (slug: CategorySlug) => CATEGORIES[slug];
export const getAllCategories = () => Object.values(CATEGORIES);
export const getCategoryColor = (slug: CategorySlug) => CATEGORIES[slug].color;
export const getCategoryIcon = (slug: CategorySlug) => CATEGORIES[slug].icon;
