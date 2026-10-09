import dynamic from "next/dynamic";
import Head from "next/head";

const SkyViewer = dynamic(
  () => import("../components/SkyViewer"),
  { ssr: false }
);

export default function Home() {
  return <><Head><title>AstroSky</title></Head><SkyViewer /></>;
}
