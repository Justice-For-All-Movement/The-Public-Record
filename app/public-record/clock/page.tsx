import type {Metadata} from "next";
import Link from "next/link";
import FoiaClockCalculator from "../../../components/foia-clock-calculator";
export const metadata:Metadata={title:"FOIA deadline estimator | The Public Record",
  description:"Estimate federal FOIA working-day and appeal dates with their uncertainty."};
export default function ClockPage(){
  return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}>
    <Link href="/">← The Public Record</Link>
    <h1 style={{fontSize:"clamp(2rem,5vw,3rem)"}}>Federal FOIA deadline estimator</h1>
    <p>Federal agencies generally have 20 working days after the right office receives a request to make a determination, with limited pauses and extensions. Weekends and federal holidays are skipped. This tool estimates dates; it does not decide whether an agency complied with the law.</p>
    <FoiaClockCalculator/>
    <p style={{marginTop:28}}><a href="https://www.justice.gov/oip/freedom-information-act-5-usc-552">5 U.S.C. § 552 (Department of Justice)</a> · <a href="https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/">OPM federal holidays</a></p>
  </main>;
}
