import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seed...");

  // Seed categories
  const categories = [
    {
      name: "Healthcare",
      slug: "healthcare",
      description:
        "Bills related to healthcare, insurance, medical services, and public health",
      color: "#3B82F6",
      icon: "heart-pulse",
    },
    {
      name: "Education",
      slug: "education",
      description:
        "Education funding, policy, school reform, and student loans",
      color: "#8B5CF6",
      icon: "graduation-cap",
    },
    {
      name: "Environment & Climate",
      slug: "environment-climate",
      description:
        "Environmental protection, climate change, conservation, and energy policy",
      color: "#10B981",
      icon: "leaf",
    },
    {
      name: "Economy & Taxes",
      slug: "economy-taxes",
      description:
        "Economic policy, taxation, fiscal matters, and business regulation",
      color: "#F59E0B",
      icon: "dollar-sign",
    },
    {
      name: "Defense & National Security",
      slug: "defense-security",
      description: "Military, defense, national security, and foreign policy",
      color: "#EF4444",
      icon: "shield",
    },
    {
      name: "Immigration",
      slug: "immigration",
      description: "Immigration policy, border security, and citizenship",
      color: "#6366F1",
      icon: "users",
    },
    {
      name: "Technology & Innovation",
      slug: "technology",
      description:
        "Technology policy, cybersecurity, telecommunications, and innovation",
      color: "#06B6D4",
      icon: "cpu",
    },
    {
      name: "Civil Rights & Justice",
      slug: "civil-rights",
      description:
        "Civil rights, criminal justice reform, voting rights, and police reform",
      color: "#EC4899",
      icon: "scale",
    },
    {
      name: "Infrastructure",
      slug: "infrastructure",
      description:
        "Transportation, public works, utilities, and infrastructure development",
      color: "#F97316",
      icon: "building",
    },
    {
      name: "Social Services",
      slug: "social-services",
      description:
        "Social Security, Medicare, Medicaid, welfare, and social safety net programs",
      color: "#A855F7",
      icon: "hand-helping",
    },
    {
      name: "Labor & Employment",
      slug: "labor-employment",
      description:
        "Workers rights, labor laws, unemployment, minimum wage, and workplace safety",
      color: "#14B8A6",
      icon: "briefcase",
    },
    {
      name: "Agriculture & Food",
      slug: "agriculture-food",
      description:
        "Farm policy, food safety, agricultural subsidies, and rural development",
      color: "#84CC16",
      icon: "wheat",
    },
    {
      name: "Housing & Urban Development",
      slug: "housing",
      description:
        "Housing policy, affordable housing, homelessness, and urban planning",
      color: "#0EA5E9",
      icon: "home",
    },
    {
      name: "Financial Services",
      slug: "financial-services",
      description:
        "Banking, financial regulation, consumer protection, and monetary policy",
      color: "#22C55E",
      icon: "landmark",
    },
    {
      name: "Veterans Affairs",
      slug: "veterans",
      description:
        "Veterans benefits, VA healthcare, military pensions, and veteran services",
      color: "#DC2626",
      icon: "medal",
    },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
    console.log(`✓ Created/Updated category: ${category.name}`);
  }

  console.log("\n✅ Seed completed successfully!");
  console.log(`   Created ${categories.length} categories`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Error during seed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
