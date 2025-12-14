// Этот файл устарел. Используйте auth_service.rs для проверки ролей.
// Функции здесь сохранены для обратной совместимости, но перенаправляют на auth_service.

use crate::auth_service::{get_user_role, UserRole};
use sqlx::PgPool;

#[allow(unused)]
pub async fn is_admin(pool: &PgPool, address: &str) -> Result<bool, sqlx::Error> {
    match get_user_role(pool, address).await {
        Ok(UserRole::Administrator) => Ok(true),
        Ok(_) => Ok(false),
        Err(_) => Ok(false),
    }
}

#[allow(unused)]
pub async fn ensure_admin(pool: &PgPool, address: &str) -> Result<(), String> {
    match is_admin(pool, address).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Access denied: user is not an administrator".to_string()),
        Err(e) => Err(format!("Database error: {}", e)),
    }
}
