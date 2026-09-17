import ProjectScreen from '@/components/Projects/ProjectScreen';

export const metadata = {
  title: 'Project',
};

// The project screen: one project, full window, for writing notes and adding
// tasks while sharing the screen. AppShell renders /focus/* without any chrome.
export default async function ProjectScreenPage({ params }) {
  const { id } = await params;
  return <ProjectScreen projectId={id} />;
}
