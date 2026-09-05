import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { test, vi, expect, beforeEach, afterEach } from 'vitest';
import CustomersView from '../CustomersView';
import { apiClient } from '@/lib/apiClient';

const { state, replace } = vi.hoisted(() => ({state:{tasks:[]},replace:vi.fn()}));
vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});
vi.mock('next/navigation',()=>({useRouter:()=>({replace}),useSearchParams:()=>new URLSearchParams('id=c1')}));
vi.mock('@/lib/apiClient',()=>({apiClient:{
 getCustomers:vi.fn().mockResolvedValue([{id:'c1',name:'Fixture customer',status:'Active'}]),
 getCustomerOverview:vi.fn().mockImplementation(()=>Promise.resolve({customer:{id:'c1',name:'Fixture customer',status:'Active'},openProjects:[],closedProjects:[],tasks:state.tasks.filter(t=>!['done','cancelled'].includes(t.state)).map(t=>({...t}))})),
 getCustomerFacts:vi.fn().mockResolvedValue([]),getContacts:vi.fn().mockResolvedValue([]),getCustomerTimeline:vi.fn().mockResolvedValue([]),getAttachments:vi.fn().mockResolvedValue([]),
 getUnfiledNotes:vi.fn().mockResolvedValue([]),getAllProjects:vi.fn().mockResolvedValue([]),getProjects:vi.fn().mockResolvedValue([]),getCustomersForCapture:vi.fn().mockResolvedValue([]),
 updateTask:vi.fn(),deleteTask:vi.fn(),
}}));
beforeEach(()=>{
 state.tasks=[{id:'t1',name:'Customer task',state:'backlog',sort_order:100,description:'Original description'}];
 apiClient.updateTask.mockImplementation(async(id,updates)=>{state.tasks=state.tasks.map(t=>t.id===id?{...t,...updates}:t); return state.tasks.find(t=>t.id===id);});
 apiClient.deleteTask.mockImplementation(async(id)=>{state.tasks=state.tasks.filter(t=>t.id!==id);return {};});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({data:[]})}));
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,top:0,left:0,right:100,bottom:30,width:100,height:30,toJSON(){}});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
test('opens the actual drawer and saves an edited task without unmounting it',async()=>{
 render(<CustomersView/>);
 fireEvent.click(await screen.findByText('Customer task'));
 const dialog=await screen.findByRole('dialog');
 const description=within(dialog).getByLabelText('Task description');
 fireEvent.change(description,{target:{value:'Revised description'}});
 fireEvent.blur(description);
 await waitFor(()=>expect(apiClient.updateTask).toHaveBeenCalledWith('t1',{description:'Revised description'}));
 expect(screen.getByRole('dialog')).toBeVisible();
 expect(screen.getByLabelText('Task description')).toHaveValue('Revised description');
});
test('reports a rejected edit and restores the saved drawer field',async()=>{
 apiClient.updateTask.mockRejectedValue(new Error('Task save failed'));
 render(<CustomersView/>);
 fireEvent.click(await screen.findByText('Customer task'));
 const description=await screen.findByLabelText('Task description');
 fireEvent.change(description,{target:{value:'Rejected description'}});
 fireEvent.blur(description);
 await screen.findByText('Task save failed');
 await waitFor(()=>expect(screen.getByLabelText('Task description')).toHaveValue('Original description'));
});
test('moves an actual customer task through its action menu',async()=>{
 render(<CustomersView/>);
 await screen.findByText('Customer task');
 fireEvent.keyDown(screen.getByRole('button',{name:'Task actions'}),{key:'ArrowDown'});
 fireEvent.click(await screen.findByText('This Week'));
 await waitFor(()=>expect(apiClient.updateTask).toHaveBeenCalledWith('t1',{state:'this_week'}));
 expect(await screen.findByText('Customer task')).toBeVisible();
});
test('completes a customer task and removes it from the active list',async()=>{
 render(<CustomersView/>);
 fireEvent.click(await screen.findByRole('checkbox',{name:'Mark "Customer task" complete'}));
 await waitFor(()=>expect(apiClient.updateTask).toHaveBeenCalledWith('t1',{state:'done'}));
 await waitFor(()=>expect(screen.queryByText('Customer task')).not.toBeInTheDocument());
});
test.each([false,true])('deletes from the drawer with server failure=%s',async(fails)=>{
 if(fails)apiClient.deleteTask.mockRejectedValue(new Error('Deletion failed'));
 render(<CustomersView/>);
 fireEvent.click(await screen.findByText('Customer task'));
 const dialog=await screen.findByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Delete task'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Yes, delete'}));
 await waitFor(()=>expect(apiClient.deleteTask).toHaveBeenCalledWith('t1'));
 if(fails){
  await screen.findByText('Deletion failed');
  expect(screen.getByText('Customer task')).toBeVisible();
 }else await waitFor(()=>expect(screen.queryByText('Customer task')).not.toBeInTheDocument());
});

test('shows a late deletion failure inside a reopened actual drawer', async () => {
 let rejectDelete;
 apiClient.deleteTask.mockImplementation(() => new Promise((_,reject) => {rejectDelete=reject;}));
 render(<CustomersView/>);
 fireEvent.click(await screen.findByText('Customer task'));
 let dialog=await screen.findByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Delete task'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Yes, delete'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 fireEvent.click(screen.getByText('Customer task'));
 dialog=await screen.findByRole('dialog');
 await act(async()=>{rejectDelete(new Error('Late deletion failed'));});
 expect(within(dialog).getByRole('alert')).toHaveTextContent('Late deletion failed');
 expect(within(dialog).getByRole('alert')).toBeVisible();
});
test('closes the drawer when a saved reassignment removes its task from the customer overview', async () => {
 fetch.mockImplementation(async(url)=>({ok:true,json:async()=>({data:url.startsWith('/api/projects')?[{id:'p2',name:'Other customer project'}]:[]})}));
 apiClient.updateTask.mockImplementation(async(id,updates)=>{
  state.tasks=[];
  return {id,name:'Customer task',state:'backlog',...updates};
 });
 render(<CustomersView/>);
 fireEvent.click(await screen.findByText('Customer task'));
 await screen.findByRole('option',{name:'Other customer project'});
 fireEvent.change(screen.getByLabelText('Task project'),{target:{value:'p2'}});
 await waitFor(()=>expect(apiClient.updateTask).toHaveBeenCalledWith('t1',{project_id:'p2'}));
 await waitFor(()=>expect(apiClient.getCustomerOverview).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
