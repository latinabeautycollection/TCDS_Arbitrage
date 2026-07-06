import { conditionDisclosure } from '../templates/conditionDisclosureTemplate';
export class DefectDisclosureEngine { build(conditionText:string, visibleDefects:string[]): string[] { return conditionDisclosure(conditionText, visibleDefects); } }
