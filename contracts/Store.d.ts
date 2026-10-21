/** 规格书 §4.3 冻结契约；此文件仅描述类型，不是平台存储实现。 */
export type Collection = 'inputs'|'sentences'|'vocab'|'progress'|'shadowing'|'dictation'|'dictation_tasks';
export type ErrorCode = 'NOT_FOUND'|'NETWORK'|'QUOTA'|'INVALID';
export interface RecordObject { id:string; [key:string]:unknown }
export interface BlobInfo { key:string; size:number; mime:string }
export interface BlobMeta { mime:string; inputId?:string; durationSec?:number }
export interface StoreApi {
 list(collection:Collection):Promise<RecordObject[]>;
 get(collection:Collection,id:string):Promise<RecordObject|null>;
 save(collection:Collection,id:string,obj:RecordObject):Promise<void>;
 remove(collection:Collection,id:string):Promise<void>;
 saveBlob(key:string,blob:Blob,meta:BlobMeta):Promise<BlobInfo>;
 getBlob(key:string):Promise<Blob|null>;
 listBlobs(prefix:string):Promise<BlobInfo[]>;
}
