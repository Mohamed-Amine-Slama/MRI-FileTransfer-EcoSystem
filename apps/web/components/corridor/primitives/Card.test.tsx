import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArrowCircle, Card } from './Card';

describe('Card (spec §6)', () => {
  it('is an article with no arrow when it links nowhere', () => {
    const html = renderToStaticMarkup(<Card variant="glass" title="The CD" label="CD-R" />);
    expect(html).toMatch(/^<article class="card card--glass"/);
    expect(html).not.toContain('arrow-circle');
    expect(html).toContain('<h3 class="card-title">The CD</h3>');
    expect(html).toContain('<span class="card-label">CD-R</span>');
  });

  it('marks its index as decoration', () => {
    const html = renderToStaticMarkup(<Card variant="lime" index="02" title="Waiting" />);
    expect(html).toContain('<span class="card-index" aria-hidden="true">02</span>');
  });

  it('renders the image variant picture as decoration, under a scrim', () => {
    const html = renderToStaticMarkup(
      <Card variant="image" title="Patients" image={{ src: '/x.avif', width: 10, height: 5 }} />,
    );
    expect(html).toContain('<img class="card-image" src="/x.avif" alt=""');
    expect(html).toContain('class="card-scrim"');
  });

  it('can carry the section heading', () => {
    const html = renderToStaticMarkup(
      <Card variant="teal" titleAs="h2" titleId="doors-title" title="Who are you?" />,
    );
    expect(html).toContain('<h2 id="doors-title" class="card-title">Who are you?</h2>');
  });

  it('keeps the arrow out of the accessibility tree', () => {
    expect(renderToStaticMarkup(<ArrowCircle />)).toMatch(/^<span class="arrow-circle" aria-hidden="true">/);
  });
});
