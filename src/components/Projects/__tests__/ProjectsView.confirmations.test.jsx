import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, test, vi, expect } from 'vitest';
import ProjectWorkspace from '@/components/Projects/ProjectWorkspace';
import ProjectsView from '@/components/Projects/ProjectsView';
import { apiClient } from '@/lib/apiClient';
vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({x:0,y:0,top:0,left:0,bottom:30,right:100,width:100,height:30,toJSON(){}});
vi.stubGlobal('ResizeObserver', class { observe(){} unobserve(){} disconnect(){} });
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=p1') }));
vi.mock('@/components/shared/QuickTaskInput', () => ({ default: () => null }));
vi.mock('@/components/shared/CustomerPicker', () => ({ default: () => null }));
vi.mock('@/components/shared/AttachmentsPanel', () => ({ default: () => null }));
vi.mock('@/components/Projects/ProjectNotes', () => ({ default: () => null }));
vi.mock('@/components/Projects/ProjectRadar', () => ({ default: () => null }));
vi.mock('@/components/shared/TaskDetailDrawer', () => ({ default: () => null }));
vi.mock('@/lib/apiClient', () => ({ apiClient: {
 deleteProject: vi.fn().mockResolvedValue({}),
 getAllProjects: vi.fn(), getAllTasks: vi.fn().mockResolvedValue([]), getProjectImpact: vi.fn(),
 updateProject: vi.fn().mockResolvedValue({}), getCustomers: vi.fn().mockResolvedValue([]), getContacts: vi.fn().mockResolvedValue([]),
}}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
test('shows customer facts after a successful customer-linked impact check', async () => {
 apiClient.getAllProjects.mockResolvedValue([{id:'p1', name:'Fixture project', status:'Open', customer_id:'c1',customer_name:'Fixture customer'}]);
 apiClient.getProjectImpact.mockResolvedValue({openTasks:[],noteCount:1,taskCount:0,customerId:'c1',customerName:'Fixture customer'});
 render(<ProjectsView/>);
 await screen.findByRole('button',{name:'Edit Project name'});
 const status = screen.getAllByRole('combobox').find(x => x.value === 'Open');
 fireEvent.change(status,{target:{value:'Completed'}});
 await waitFor(() => expect(apiClient.getProjectImpact).toHaveBeenCalledWith('p1'));
 await waitFor(() => expect(screen.queryByText('Checking for open tasks...')).not.toBeInTheDocument());
 expect(screen.getByRole('textbox',{name:'Key fact label'})).toBeVisible();
 expect(screen.queryByText(/keep them on a customer record/)).not.toBeInTheDocument();
});
test('blocks closing after an impact failure and allows retrying the check', async () => {
 apiClient.getAllProjects.mockResolvedValue([{id:'p1',name:'Fixture project',status:'Open'}]);
 apiClient.getProjectImpact.mockRejectedValue(new Error('Impact unavailable'));
 render(<ProjectsView/>);
 await screen.findByRole('button',{name:'Edit Project name'});
 const status = screen.getAllByRole('combobox').find(x => x.value === 'Open');
 fireEvent.change(status,{target:{value:'Cancelled'}});
 await screen.findByText('Impact unavailable');
 expect(screen.queryByText('This project has no open tasks.')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Cancel project'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Cancel project'}));
 expect(apiClient.updateProject).not.toHaveBeenCalled();
 apiClient.getProjectImpact.mockResolvedValue({openTasks:[],noteCount:0});
 fireEvent.click(screen.getByRole('button',{name:'Retry impact check'}));
 await waitFor(() => expect(screen.getByRole('button',{name:'Cancel project'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Cancel project'}));
 await waitFor(() => expect(apiClient.updateProject).toHaveBeenCalledWith('p1',expect.objectContaining({status:'Cancelled'})));
});

test('blocks deletion after an impact failure and names the retained notes destination after retry', async () => {
 apiClient.getAllProjects.mockResolvedValue([{id:'p1',name:'Fixture project',status:'Open'}]);
 apiClient.getProjectImpact.mockRejectedValue(new Error('Impact unavailable'));
 render(<ProjectsView/>);
 await screen.findByRole('button',{name:'Edit Project name'});
 fireEvent.keyDown(screen.getByRole('button',{name:'Project actions'}),{key:'ArrowDown'});
 fireEvent.click(await screen.findByText('Delete project'));
 await screen.findByText('Impact unavailable');
 expect(screen.getByRole('button',{name:'Delete project'})).toBeDisabled();
 expect(screen.queryByText('This project has no notes.')).not.toBeInTheDocument();
 apiClient.getProjectImpact.mockResolvedValue({openTasks:[],noteCount:2,customerName:'Fixture customer'});
 fireEvent.click(screen.getByRole('button',{name:'Retry impact check'}));
 await screen.findByText('Fixture customer');
 expect(screen.queryByText(/left unfiled/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Delete project'}));
 await waitFor(() => expect(apiClient.deleteProject).toHaveBeenCalledWith('p1',{destroyContent:false}));
});
test.each(['Completed', 'Cancelled'])('confirms reopening a %s project and shows only tasks to restore', async (previousStatus) => {
 apiClient.getAllProjects.mockResolvedValue([{id:'p1',name:'Fixture project',status:previousStatus}]);
 apiClient.getProjectImpact.mockResolvedValue({openTasks:[],noteCount:0,reopeningTasks:previousStatus==='Cancelled'?[{id:'restore',name:'Restore this task',state:'cancelled'}]:[]});
 render(<ProjectsView/>);
 const status = await screen.findByRole('combobox',{name:'Project status'});
 fireEvent.change(status,{target:{value:'Open'}});
 await screen.findByRole('button',{name:'Reopen project'});
 await waitFor(() => expect(screen.queryByText('Checking for open tasks...')).not.toBeInTheDocument());
 expect(apiClient.updateProject).not.toHaveBeenCalled();
 if (previousStatus==='Cancelled') expect(screen.getByText('Restore this task')).toBeVisible();
 else expect(screen.getByText('No tasks will be reopened. Completed tasks stay done.')).toBeVisible();
 expect(screen.queryByLabelText('Key fact label')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reopen project'}));
 await waitFor(() => expect(apiClient.updateProject).toHaveBeenCalledWith('p1',expect.objectContaining({status:'Open'})));
});

test('keeps a checked impact usable after a rejected save', async () => {
 apiClient.getAllProjects.mockResolvedValue([{id:'p1',name:'Fixture project',status:'Open'}]);
 apiClient.getProjectImpact.mockResolvedValue({openTasks:[{id:'t1',name:'Affected task'}],noteCount:0});
 apiClient.updateProject.mockRejectedValueOnce(new Error('Project save failed'));
 render(<ProjectsView/>);
 const status=await screen.findByRole('combobox',{name:'Project status'});
 fireEvent.change(status,{target:{value:'Completed'}});
 const confirm=await screen.findByRole('button',{name:'Complete project and 1 task'});
 fireEvent.click(confirm);
 await screen.findByText('Project save failed');
 expect(screen.getByText('Affected task')).toBeVisible();
 expect(confirm).toBeEnabled();
 expect(screen.queryByRole('button',{name:'Retry impact check'})).not.toBeInTheDocument();
});
