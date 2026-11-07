import { adminTransport } from './transport.js';
import { normalizeReference, normalizeRegistry, normalizeAdminPage, referenceKinds } from './contracts.js';
import { DataError } from '../data/errors.js';
export function createManagementClient(request=adminTransport) {
  function resource(area,kind) {
    if (!(area==='references'?referenceKinds:area==='registries'?['lecturers','alumni']:[]).includes(kind)) throw new DataError('VALIDATION','Անվավեր ցանկ։');
    return `/`+area+`/`+kind;
  }
  const recordId=id=>{if(typeof id!=='string'||!/^[1-9][0-9]*$/.test(id))throw new DataError('VALIDATION','Անվավեր գրառում։');return id;};
  const normalize=(area,kind)=>area==='references'?normalizeReference:v=>normalizeRegistry(v,kind);
  return {
    async list(area,kind,{q='',cursor=''}={}) {return normalizeAdminPage(await request(resource(area,kind)+'?'+new URLSearchParams({q,cursor})),normalize(area,kind));},
    async get(area,kind,id) {return normalize(area,kind)(await request(resource(area,kind)+'/'+recordId(id)));},
    async create(area,kind,data) {return normalize(area,kind)(await request(resource(area,kind),{method:'POST',data}));},
    async update(area,kind,id,data) {return normalize(area,kind)(await request(resource(area,kind)+'/'+recordId(id),{method:'PUT',data}));},
    async delete(area,kind,id,version) {await request(resource(area,kind)+'/'+recordId(id),{method:'DELETE',data:{version}});},
  };
}
