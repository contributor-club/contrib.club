import { expect, test } from '@playwright/test';

test('home page renders hero', async ({ page }) => {
	await page.goto('/');
	const subtitle = page.locator('[data-test="hero-subtitle"]');
	await expect(subtitle).toBeVisible();
});

test('GitHub stats render from server data', async ({ page }) => {
	await page.goto('/');
	const stars = page.locator('[data-test="stat-stars"] [data-test="stat-value"]');
	const forks = page.locator('[data-test="stat-forks"] [data-test="stat-value"]');
	const members = page.locator('[data-test="stat-members"] [data-test="stat-value"]');
	await expect(stars).toBeVisible();
	await expect(forks).toBeVisible();
	await expect(members).toBeVisible();
});

test('Projects list shows stars pulled from GitHub', async ({ page }) => {
	await page.goto('/');
	const firstProject = page.locator('[data-test="project-card"]').first();
	await expect(firstProject).toBeVisible();
	const starValue = firstProject.locator('[data-test="project-stars"]').locator('span').last();
	await expect(starValue).toHaveText(/[\d.,kKmM]+|0/);
});
