/* FundMyCampus medical-loan decision engine (spec v2.0, Appendix E). Screening illustration only — not a lender decision. */
(function(root){
'use strict';
const money=n=>'₹'+Math.round(n).toLocaleString('en-IN');
const securedCountries=['Russia','Uzbekistan','Kyrgyzstan','Kazakhstan'];
function emi(p,r,y){const m=r/1200,n=y*12;return m?p*m*Math.pow(1+m,n)/(Math.pow(1+m,n)-1):p/n;}
function grid(amount,secured){
 const caps=[25,50,75,100,125,150], payments=secured?[5000,15000,20000,30000,40000,50000]:[5000,15000,40000,60000,80000,100000];
 let i=caps.findIndex(v=>amount<=v*100000);
 if(i<0)return secured?{payment:75000,income:400000/12,verified:true}:{payment:null,income:null,verified:false};
 return {payment:payments[i],income:i===0?null:secured?400000/12:i===5?70000:50000,verified:i!==0};
}
function creditGate(s){
 const valid=v=>typeof v==='number'&&Number.isInteger(v)&&v>=300&&v<=900;
 const student=s.studentCibilStatus==='known'&&valid(s.studentCibil)?s.studentCibil:null;
 const people=Array.isArray(s.coApplicants)?s.coApplicants:[];
 const parentQualifies=people.some(c=>c.relationship==='parent'&&c.cibilStatus==='known'&&valid(c.cibil)&&c.cibil>700);
 const invalid=(s.studentCibilStatus==='known'&&!valid(s.studentCibil))||people.some(c=>c.cibilStatus==='known'&&!valid(c.cibil));
 const result={student,parentQualifies,invalid,mode:'review',message:'',ruleVersion:'FMC-CREDIT-2026-10-14-v1'};
 if(invalid)return {...result,message:'Enter whole-number CIBIL scores from 300 to 900. Unknown or no-history status must be selected separately.'};
 if(student!==null&&student<670)return {...result,mode:'blocked',message:'Student CIBIL is below 670. No loan route is offered under the current FundMyCampus screening rules. A counsellor can review the credit report; this is not a bank decision.'};
 if(student!==null&&student<=700)return {...result,mode:'direct_only',message:'Student CIBIL is 670–700 (inclusive): only a direct-EMI route can be considered under the FundMyCampus screen.'+(parentQualifies?' At least one parent is above 700.':' No parent with a confirmed score above 700 is recorded; lender review is required.')};
 if(student===null)return {...result,message:'Student CIBIL is not confirmed. Enter a score or ask for a credit-profile review; normal routes are not confirmed yet.'};
 if(!parentQualifies)return {...result,message:'Student CIBIL is above 700, but no parent has a confirmed score above 700. Normal treatment requires at least one such parent; the fallback needs lender review.'};
 return {...result,mode:'normal',message:'Student CIBIL is above 700 and at least one parent is above 700. Normal product screening applies; income, college and other lender conditions still matter.'};
}
function schemeBenefit(s,hasScheme){
 if(!hasScheme)return null;
 const common='Interest support requires a separate verified claim. Loan eligibility and subsidy eligibility are different.';
 if(s.otherBenefit==='yes')return {kind:'excluded',message:'An existing government scholarship, fee reimbursement or interest subsidy can exclude this interest support. '+common};
 if(s.otherBenefit!=='no'||s.familyIncomeStatus!=='known')return {kind:'review',message:'Confirm annual gross family income and other government benefits to review interest support. '+common};
 const annual=s.familyIncome;
 if(!Number.isFinite(annual)||annual<0)return {kind:'review',message:'Enter a valid annual family income for benefit review.'};
 if(annual<=450000)return {kind:'csis_review',cap:1000000,message:'Your income band may qualify for full moratorium-period interest support under CSIS on the eligible loan portion up to ₹10 lakh. Approved institution/course and other conditions must be checked. If CSIS does not apply, review the separate 3% scheme; benefits cannot be stacked.'};
 if(annual<=800000)return {kind:'pmv_3',cap:1000000,message:'Your income band may qualify for 3% interest subvention during moratorium on eligible disbursed principal up to ₹10 lakh, subject to scheme conditions and selection. This does not reduce the rate on your entire loan by 3 percentage points.'};
 return {kind:'above_limit',message:'Family income is above ₹8 lakh: these income-linked subsidy bands do not apply. The scheme loan can still be considered.'};
}
function campaign(s){
 const today=s.today||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const deadline='2026-11-15';
 const supplied=s.applicationDate||'';
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(supplied)&&!Number.isNaN(Date.parse(supplied))&&new Date(supplied).toISOString().slice(0,10)===supplied&&supplied<=today;
 return {active:today<=deadline||(validDate&&supplied<=deadline),deadline,applicationConfirmed:validDate&&supplied<=deadline};
}
function assess(s){
 const p=s.amount*100000,monthly=emi(p,s.rate,s.tenure),si=p*s.rate/1200,income=s.incomes.reduce((a,b)=>a+b,0),existing=s.existing,foir=s.foir/100;
 const need=Math.max((monthly+existing)/foir,monthly+existing+30000),ratio=income>0?(monthly+existing)/income*100:Infinity;
 const secured=s.collateral==='yes'&&s.value>=s.amount;
 let routes=[],notes=[],docs=['Student and co-applicant KYC','Admission letter and detailed fee schedule','Academic marksheets and entrance / counselling result'];
 const add=(id,title,status,payment,repayment,security,reason,extra={})=>routes.push({id,title,status,payment,repayment,security,reason,...extra});
 const direct=(reason,mandatory=false)=>{let status=mandatory&&!secured?'gap':income>=need?'match':'gap';add('emi','Direct-EMI lender route',status,monthly,'Principal + interest from disbursement',mandatory?'Collateral required':'Collateral may be optional',reason+(mandatory&&!secured?' Collateral is missing or its stated value is below the requested loan.':'')+(income<need?' Combined documented income is below this direct-EMI screening requirement.':''),{requiredIncome:need,rate:s.destination==='India'?'10.5%–13% p.a. indicative':'Lender quote required'});};
 if(s.destination==='India'){
  if(!s.college){return {incomplete:true,message:'Choose your college to see your possible loan routes.',monthly,si,income,need,ratio,routes,notes,docs};}
  const q=s.college.qheiStatus;
  if(q==='listed'&&s.admission==='merit'&&s.campus==='yes'){
   add('pmv','PM-Vidyalaxmi · scheme route','match',0,'Course period + 1 year moratorium','No collateral required','Your institution is in the configured QHEI registry and you have confirmed merit admission at that exact campus/course. Listing provenance and admission evidence still need verification.',{rate:s.college.rateFormula||'Bank / institute category rate',fee:'Nil processing / documentation fee',margin:'Subject to institution category and sanction terms'});
   notes.push('Interest accrues during moratorium unless an applicable subsidy covers it. The bank decides eligible expenses, sanction amount and final terms. Parents / guardians remain joint borrowers.');
  }else if(s.admission==='management'){
   notes.push('Management / NRI quota is excluded from the PM-Vidyalaxmi / QHEI route in this checker, even if the institution is listed. Alternative lender products can still be reviewed.');
  }else if(q==='listed'||q==='pending'){
   add('verify','QHEI route · verification needed','review',null,'Moratorium subject to scheme eligibility','Subject to eligibility',q==='pending'?'Institution coverage needs verification before scheme benefits can be assessed.':s.admission==='management'?'Management-quota admission is not treated as merit-based scheme eligibility. Review alternative routes below.':'Confirm merit admission and the exact teaching institution / campus before applying scheme benefits.');
  }else notes.push('No confirmed QHEI match in this snapshot. This is not a bank rejection; spelling, campus identity and later updates need checking.');
  const standardCourse=['MBBS','BDS','MD','MS','MDS'].includes(s.course);
  const promo=campaign(s);
  if(standardCourse&&s.amount>7.5){
   const roi=secured?9.25:10.75, study=p*roi/1200, future=emi(p,roi,s.tenure), required=(future+existing)/foir;
   if(promo.active){
    const status=income===0||income<required?'gap':s.profile==='salaried'?'match':'review';
    add('si','Medical education · simple-interest route',status,study,'Simple interest during study for UG and PG; full EMI later',secured?'Secured pricing — valuation pending':'Unsecured pricing — acceptance pending',`Co-applicant income ${money(income)}/month is checked against an illustrative future-EMI FOIR requirement of ${money(required)}/month. Student stipend is not substituted for co-applicant income in this route.`,{requiredIncome:required,rate:roi+'% p.a. campaign rate, subject to confirmation',fee:'₹19,999 + applicable GST',futureEmi:future});
    notes.push('Campaign applies to eligible application IDs created through 15 November 2026, irrespective of disbursement date. A website enquiry is not a lender application ID. Rate, security and income acceptance require confirmation.');
   }else notes.push('The medical simple-interest campaign has ended for new application IDs. Existing eligible application IDs dated through 15 November 2026 require verification; otherwise request current terms.');
  }else if(standardCourse)notes.push('The medical simple-interest campaign requires a loan strictly above ₹7.5 lakh; smaller amounts need a separate product quote.');
  if(s.level==='Masters'&&['MD','MS','MDS','DNB'].includes(s.course)){
   const g=grid(p,secured),combined=income+s.stipend;
   if(g.payment!==null){
    const fit=g.income===null?null:combined>=g.income;
    add('pg','Medical PG · flexible-income review',fit===false?'gap':'review',g.payment,'Band-based partial payment during study; full EMI later',secured?'Secured repayment grid':'Unsecured repayment grid',`Documented student stipend ${money(s.stipend)} + co-applicant income ${money(income)} = ${money(combined)}/month for assessment. Stipend alone can be considered without a financial co-applicant if accepted income satisfies lender underwriting. There is no separate ₹60,000 stipend threshold.`,{requiredIncome:g.income,rate:'Lender quote required'});
    notes.push('The payment band depends on loan amount and security, not the stipend amount. Income acceptance, course scope, FOIR, stipend continuity and non-financial co-applicant requirements need lender review. Unpaid interest may be capitalised.');
    if(g.income===null)notes.push('Loans up to ₹25 lakh have no stated minimum income in the supplied grid. Do not assume an income threshold.');
   }else notes.push('No unsecured partial-payment band is supplied above ₹1.5 crore; request a product review.');
  }
  if(!routes.some(r=>r.id==='pmv'||r.id==='si'&&r.status==='match'))direct('Alternative direct-EMI review when a scheme or simple-interest route does not fit. This is a separate product.');
  if(!standardCourse)notes.push('This course requires confirmation of product coverage; no standard medical campaign is inferred.');
  if(!routes.some(r=>r.id==='pmv'))add('public','Public-sector bank · secured review',secured?'review':'gap',null,'Lender-specific repayment terms','Indicative collateral target: 100% of loan',secured?'Your stated collateral value covers the requested loan. Bank valuation, title and product criteria still apply.':'The supplied non-QHEI route expects collateral approximately equal to the loan; smaller-loan schemes may have exceptions.');
 }else{
  if(!s.country||!s.foreignCollege.trim())return {incomplete:true,message:'Select a country and enter your university to see the overseas route.',monthly,si,income,need,ratio,routes,notes,docs};
  if(securedCountries.includes(s.country))direct(`${s.country}: FundMyCampus’s supplied route requires collateral plus an income-supported direct EMI.`,true);
  else if(['Georgia','Italy'].includes(s.country))direct(`${s.country}: the supplied route can be reviewed without mandatory collateral; direct EMI and acceptable co-applicant income are required.`);
  else add('country','Country-specific lender review','review',null,'Repayment to be confirmed','Collateral to be confirmed','No verified country rule is configured for this destination. The calculator below is only an affordability illustration.');
  docs.push('Passport and overseas university / course approval documents');notes.push('Overseas rules are FundMyCampus screening assumptions, not universal bank policies. Confirm university acceptance, recognised course, tenure and country-specific lender terms.');
 }
 if(income>0)docs.push(s.profile==='salaried'?'Salary slips and bank statements':'ITRs, income evidence and bank statements');
 if(s.collateral==='yes')docs.push('Property title chain and lender valuation / legal documents');
 if(s.level==='Masters'&&s.destination==='India')docs.push('Stipend letter and credited stipend evidence');
 if(routes.some(r=>r.id==='pmv'))docs.push('Family income certificate and existing-loan details, as required by the bank');
 const credit=creditGate(s);
 const exclusions=s.destination==='India'&&s.admission==='management'?['PM-Vidyalaxmi / QHEI route excluded: management / NRI quota is not accepted.']:[];
 notes.push('CIBIL scores are self-reported. These thresholds are FundMyCampus screening rules supplied on 14 October 2026, not universal bank policies or a credit-bureau enquiry.');
 if(credit.invalid)return {incomplete:true,message:credit.message,monthly,si,income,need,ratio,routes:[],notes,docs,credit,exclusions};
 if(credit.mode==='blocked')routes=[];
 else if(credit.mode==='direct_only'){
  routes=[];
  if(s.destination==='India'||securedCountries.includes(s.country)||['Georgia','Italy'].includes(s.country)){
   direct('Student CIBIL permits direct EMI only; moratorium, simple-interest and partial-payment routes are excluded by the credit screen.',s.destination!=='India'&&securedCountries.includes(s.country));
   if(!credit.parentQualifies&&routes[0].status==='match')routes[0].status='review';
   if(!credit.parentQualifies)routes[0].reason+=' Parent credit requirement is unresolved; numerical affordability is not eligibility.';
  }else add('country','Direct EMI only · country policy review','review',null,'Only direct EMI can be considered','Country-specific collateral policy',credit.message+' No country-specific lender policy is configured.');
 }else if(credit.mode==='review'){
  routes=[];
  add('credit_review','Credit profile · lender review','review',null,'Repayment route not confirmed','Product requirements pending',credit.message);
 }
 const benefit=schemeBenefit(s,routes.some(r=>r.id==='pmv'));
 return {incomplete:false,monthly,si,income,need,ratio,routes,notes,docs,secured,credit,exclusions,benefit};
}
const api={money,emi,grid,creditGate,schemeBenefit,campaign,assess};if(typeof module!=='undefined')module.exports=api;else root.LoanEngine=api;
})(typeof window!=='undefined'?window:globalThis);
