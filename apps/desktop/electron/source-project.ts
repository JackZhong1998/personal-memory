import {basename,normalize,isAbsolute} from 'node:path';
import type {SourceProject} from './types';

export function directoryProject(value:unknown):SourceProject|undefined {
 if(typeof value!=='string'||!isAbsolute(value))return;
 const path=normalize(value);
 return {id:`directory:${path}`,name:basename(path)||path,path};
}
