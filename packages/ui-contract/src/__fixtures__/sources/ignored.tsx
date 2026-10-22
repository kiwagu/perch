// Coverage-ignore markers: a subtree, an element alone, and an element in an attribute.
export function Ignored(props: { readonly open: () => void; readonly close: () => void }) {
  return (
    <section>
      {/* ui-contract-ignore: a decorative pager, no scenario pages through it */}
      <nav>
        <a href="/first">first</a>
        <button type="button" onClick={props.open}>
          next
        </button>
        <Button data-testid="sample.save-button">Save</Button>
      </nav>
      {/* ui-contract-ignore-self: the card link is a mouse convenience */}
      <Link to="/card">
        <Button onClick={props.open}>Open</Button>
      </Link>
      {/* ui-contract-ignore-self: the home link is drawn twice, this one for show */}
      <Link to="/" data-testid="sample.home-link">
        <Button size="icon">
          <HomeIcon />
        </Button>
      </Link>
      <label>
        Name
        {/* ui-contract-ignore: the name is typed in the form, not here */}
        <input name="name" />
      </label>
      <Close
        render={
          // ui-contract-ignore-self: the button Close renders for its caller
          <Button variant="ghost" />
        }
      >
        <a href="/inside">
          Go <b>inside</b>
        </a>
      </Close>
      <button type="button" aria-label="Close" onClick={props.close}>
        <XIcon />
      </button>
    </section>
  )
}
