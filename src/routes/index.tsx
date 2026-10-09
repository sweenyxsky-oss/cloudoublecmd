import { createFileRoute } from "@tanstack/react-router";
import { Commander } from '@/components/commander';

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: 'ClouDouble Commander — TrueNAS File Manager' },
    { name: 'description', content: 'Windows-style dual-pane TrueNAS file manager with colored icons, light and dark modes, keyboard and mouse file operations, archive tools and NAS-hosted deployment.' },
    { property: 'og:title', content: 'ClouDouble Commander — TrueNAS File Manager' },
    { property: 'og:description', content: 'A web-native Total Commander-style workspace for browsing TrueNAS datasets.' },
    { property: 'og:type', content: 'website' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: Commander,
});
