import { PhotoIntelligenceEngine } from '../engines/photoIntelligenceEngine';
export class ListingImageService { constructor(private engine=new PhotoIntelligenceEngine()){} process(urls:string[]){ return this.engine.process(urls); } }
