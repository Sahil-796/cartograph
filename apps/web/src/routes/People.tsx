import { useParams } from "react-router-dom";
import PeopleView from "../features/people/PeopleView";

/** The `/r/:repoId/people` route: the people / ownership view (Wave-2 stub). */
export default function People() {
  const { repoId = "" } = useParams();
  return <PeopleView repoId={repoId} />;
}
