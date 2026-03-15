export function Banner({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "success";
}) {
  return (
    <p className={tone === "error" ? "banner banner--error" : "banner"}>
      {message}
    </p>
  );
}
