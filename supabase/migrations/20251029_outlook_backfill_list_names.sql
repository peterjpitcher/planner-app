update project_outlook_lists pol
set graph_list_name = p.name
from projects p
where pol.project_id = p.id
  and pol.graph_list_name is null;
