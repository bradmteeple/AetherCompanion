import Link from "next/link";

const pages = [
  { href: "/social", label: "Social" },
  { href: "/team-builder", label: "Team Builder" },
  { href: "/battle", label: "Battle" },
  { href: "/my-page", label: "My Page" },
];

export default function Home() {
  return (
    <>
      <h1 className="page-title">Aether Companion</h1>
      <p className="page-text">
        Your companion for improving at VGC. Pick a section to get started.
      </p>
      <div className="button-grid">
        {pages.map((page) => (
          <Link key={page.href} href={page.href} className="button">
            {page.label}
          </Link>
        ))}
      </div>
    </>
  );
}
