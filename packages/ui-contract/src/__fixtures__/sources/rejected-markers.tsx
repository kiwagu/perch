// Coverage-ignore markers that are refused: each is a problem and declares nothing off.
export function Rejected() {
  return (
    <section>
      <Close
        render={
          // ui-contract-ignore:
          // the reason must stand on the marker itself
          <Button variant="ghost" />
        }
      />
      <Close
        render={
          // ui-contract-ignore-self: a reason
          // with a comment between the marker and its element
          <Button variant="outline" />
        }
      />
      <Close render={/* ui-contract-ignore-self: a block comment in code */ <Button />} />
      {/* ui-contract-ignore: nothing follows but the closing tag */}
    </section>
  )
}
