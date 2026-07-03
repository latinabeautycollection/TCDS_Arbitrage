import { CategorySpecialistName, ProductDigitalTwin } from '../models/enterpriseListingTypes';

export interface CategorySpecialistGuidance { specialist: CategorySpecialistName; requiredSignals: string[]; titlePattern: string; disclosureFocus: string[]; buyerConfidenceDrivers: string[]; }

export class CategorySpecialistRouter {
  route(twin: ProductDigitalTwin): CategorySpecialistGuidance {
    const key = `${twin.categoryKey ?? ''} ${twin.identity.title ?? ''}`.toLowerCase();
    if (/(iphone|ipad|camera|laptop|macbook|sony|canon|nikon|electronics|console)/.test(key)) return electronics();
    if (/(gucci|lv|louis vuitton|prada|chanel|rolex|omega|designer|luxury)/.test(key)) return luxury();
    if (/(card|coin|comic|collectible|signed|graded|psa|bgs)/.test(key)) return collectibles();
    if (/(xbox|playstation|nintendo|switch|ps5|gpu|gaming)/.test(key)) return gaming();
    if (/(tool|industrial|commercial|meter|test equipment)/.test(key)) return industrial();
    if (/(home|kitchen|appliance|furniture|vacuum)/.test(key)) return homeGoods();
    return generic();
  }
}
function electronics(): CategorySpecialistGuidance { return { specialist:'electronics', requiredSignals:['brand','model','mpn','storage/capacity if applicable','tested status','included accessories'], titlePattern:'Brand Model MPN Key Spec Condition', disclosureFocus:['power-on test','screen/body wear','battery/charger status','locks/accounts removed'], buyerConfidenceDrivers:['tested functions','clean accessory list','exact model identifiers'] }; }
function luxury(): CategorySpecialistGuidance { return { specialist:'luxury', requiredSignals:['brand','model','serial/authentication where available','material','measurements'], titlePattern:'Brand Model Material Size Authenticity Signal Condition', disclosureFocus:['authenticity evidence','wear areas','odor/stains','included box/dustbag'], buyerConfidenceDrivers:['provenance','clear close-up photos','transparent flaw disclosure'] }; }
function collectibles(): CategorySpecialistGuidance { return { specialist:'collectibles', requiredSignals:['year','set/series','grade','variant','authenticator if any'], titlePattern:'Year Brand/Set Subject Variant Grade Key Identifier', disclosureFocus:['surface wear','edges/corners','grading ambiguity'], buyerConfidenceDrivers:['exact identifiers','photo clarity','grade caveat'] }; }
function gaming(): CategorySpecialistGuidance { return { specialist:'gaming', requiredSignals:['platform','model','storage','controller/accessory list','tested status'], titlePattern:'Platform Model Storage Bundle Contents Condition', disclosureFocus:['disc drive','controller drift','account locks','missing cables'], buyerConfidenceDrivers:['tested status','bundle completeness','fast shipping clarity'] }; }
function industrial(): CategorySpecialistGuidance { return { specialist:'industrial', requiredSignals:['manufacturer','model','part number','voltage/specs','tested/calibration status'], titlePattern:'Manufacturer Model Part Number Spec Application Condition', disclosureFocus:['calibration','missing probes','power requirements','cosmetic wear'], buyerConfidenceDrivers:['exact part number','application compatibility','testing limitations'] }; }
function homeGoods(): CategorySpecialistGuidance { return { specialist:'home_goods', requiredSignals:['brand','model','size/capacity','material/color','included parts'], titlePattern:'Brand Model Type Size Color Condition', disclosureFocus:['wear/stains','missing parts','measurements'], buyerConfidenceDrivers:['clean photos','measurements','included parts'] }; }
function generic(): CategorySpecialistGuidance { return { specialist:'generic', requiredSignals:['brand','model','condition','included items'], titlePattern:'Brand Model Product Type Key Feature Condition', disclosureFocus:['visible defects','missing accessories','testing limitations'], buyerConfidenceDrivers:['specificity','clear condition','complete item specifics'] }; }
